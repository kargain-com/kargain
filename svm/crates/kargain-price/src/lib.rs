//! Sole owner of PriceUpdateV2 message-at-41 decode and purchase-time price decisions.
//!
//! Layout measured in `svm/lab` (`PriceUpdateV2_msg@41`, 134 bytes). Product code must not
//! re-parse offsets or invent a second freshness/confidence path.

use kargain_errors::KargainError;

/// Measured account size for PriceUpdateV2 (receiver-owned on Devnet).
pub const PRICE_UPDATE_V2_LEN: usize = 134;

/// Discriminator measured `22f123639d7ef4cd` (soft-check; wrong disc → InvalidFeed).
pub const PRICE_UPDATE_V2_DISC: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

pub const FEED_ID_OFFSET: usize = 41;
pub const PRICE_I64_OFFSET: usize = 73;
pub const CONF_U64_OFFSET: usize = 81;
pub const EXPO_I32_OFFSET: usize = 89;
pub const PUBLISH_TIME_OFFSET: usize = 93;

/// Fail-closed clock skew: publish_time more than this many seconds ahead of `now` → BadOracleAnswer.
pub const PUBLISH_AHEAD_SKEW_SECS: i64 = 60;

/// EVM `MIN_FEED_STALENESS` / `MAX_FEED_STALENESS` — admit bounds (checked by mode, not here).
pub const MIN_FEED_STALENESS: u32 = 60;
pub const MAX_FEED_STALENESS: u32 = 259_200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PriceReading {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

fn read_i64_le(data: &[u8], off: usize) -> i64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[off..off + 8]);
    i64::from_le_bytes(buf)
}

fn read_u64_le(data: &[u8], off: usize) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[off..off + 8]);
    u64::from_le_bytes(buf)
}

fn read_i32_le(data: &[u8], off: usize) -> i32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&data[off..off + 4]);
    i32::from_le_bytes(buf)
}

/// Decode + gate a PriceUpdateV2 account for purchase / quote.
///
/// - `InvalidFeed` — wrong owner, short data, wrong discriminator, or wrong feed_id
/// - `BadOracleAnswer` — price ≤ 0, or publish_time ahead of now beyond skew
/// - `StalePrice` — age > staleness_tolerance
/// - `ConfidenceTooWide` — conf * 10_000 / |price| > max_conf_bps (D-07)
pub fn read_price_update(
    data: &[u8],
    owner: &[u8; 32],
    expected_program: &[u8; 32],
    expected_feed_id: &[u8; 32],
    now_unix: i64,
    staleness_tolerance: u32,
    max_conf_bps: u32,
) -> Result<PriceReading, KargainError> {
    if owner != expected_program {
        return Err(KargainError::InvalidFeed);
    }
    if data.len() < PRICE_UPDATE_V2_LEN {
        return Err(KargainError::InvalidFeed);
    }
    if data[0..8] != PRICE_UPDATE_V2_DISC {
        return Err(KargainError::InvalidFeed);
    }
    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[FEED_ID_OFFSET..FEED_ID_OFFSET + 32]);
    if &feed_id != expected_feed_id {
        return Err(KargainError::InvalidFeed);
    }
    let price = read_i64_le(data, PRICE_I64_OFFSET);
    let conf = read_u64_le(data, CONF_U64_OFFSET);
    let expo = read_i32_le(data, EXPO_I32_OFFSET);
    let publish_time = read_i64_le(data, PUBLISH_TIME_OFFSET);

    if price <= 0 {
        return Err(KargainError::BadOracleAnswer);
    }
    // Fail-closed on future publish beyond skew.
    if publish_time > now_unix.saturating_add(PUBLISH_AHEAD_SKEW_SECS) {
        return Err(KargainError::BadOracleAnswer);
    }
    let age = if publish_time >= now_unix {
        0i64
    } else {
        now_unix.saturating_sub(publish_time)
    };
    if age > i64::from(staleness_tolerance) {
        return Err(KargainError::StalePrice);
    }

    // conf * 10_000 / |price| > max_conf_bps
    let abs_price = price.unsigned_abs();
    if abs_price == 0 {
        return Err(KargainError::BadOracleAnswer);
    }
    let conf_bps = (u128::from(conf) * 10_000u128) / u128::from(abs_price);
    if conf_bps > u128::from(max_conf_bps) {
        return Err(KargainError::ConfidenceTooWide);
    }

    Ok(PriceReading {
        feed_id,
        price,
        conf,
        expo,
        publish_time,
    })
}

/// Convert Pyth-style (price, expo) to USD 1e8 fixed-point (EVM Chainlink 8-dec scale).
///
/// When `expo == -8`, `price` is already 1e8 units (lab / receiver layout).
pub fn price_to_usd_1e8(price: i64, expo: i32) -> Result<u128, KargainError> {
    if price <= 0 {
        return Err(KargainError::BadOracleAnswer);
    }
    let p = price as u128;
    // usd_1e8 = price * 10^(8 + expo)
    let power = 8i32.checked_add(expo).ok_or(KargainError::ArithmeticOverflow)?;
    if power == 0 {
        return Ok(p);
    }
    if power > 0 {
        let mul = 10u128
            .checked_pow(power as u32)
            .ok_or(KargainError::ArithmeticOverflow)?;
        p.checked_mul(mul).ok_or(KargainError::ArithmeticOverflow)
    } else {
        let div = 10u128
            .checked_pow((-power) as u32)
            .ok_or(KargainError::ArithmeticOverflow)?;
        Ok(p / div)
    }
}

/// Fiat USD 1e8 → token amount. Mirrors EVM `_usdToTokenAmount`:
/// `(usd1e8 * 10^decimals) / feed_price_1e8`.
pub fn usd_1e8_to_asset_amount(
    usd1e8: u128,
    asset_price_1e8: u128,
    asset_decimals: u8,
) -> Result<u64, KargainError> {
    if asset_price_1e8 == 0 {
        return Err(KargainError::BadOracleAnswer);
    }
    let scale = 10u128
        .checked_pow(u32::from(asset_decimals))
        .ok_or(KargainError::ArithmeticOverflow)?;
    let num = usd1e8
        .checked_mul(scale)
        .ok_or(KargainError::ArithmeticOverflow)?;
    let amount = num / asset_price_1e8;
    u64::try_from(amount).map_err(|_| KargainError::ArithmeticOverflow)
}

/// Quote fiat lot price (USD 1e8 on lot) → settlement asset units via feed reading.
pub fn fiat_usd_1e8_to_token_amount(
    fiat_price_1e8: u64,
    reading: &PriceReading,
    token_decimals: u8,
) -> Result<u64, KargainError> {
    let feed_1e8 = price_to_usd_1e8(reading.price, reading.expo)?;
    usd_1e8_to_asset_amount(u128::from(fiat_price_1e8), feed_1e8, token_decimals)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: [u8; 32] = [
        0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda,
        0x39, 0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80,
        0xb5, 0x6d,
    ];
    const OWNER: [u8; 32] = [7u8; 32];

    fn lab(name: &str) -> &'static [u8] {
        match name {
            "fresh_narrow" => include_bytes!("../../../lab/fixtures/price-measure/lab-fresh_narrow.bin"),
            "stale" => include_bytes!("../../../lab/fixtures/price-measure/lab-stale.bin"),
            "wide_conf" => include_bytes!("../../../lab/fixtures/price-measure/lab-wide_conf.bin"),
            "non_positive" => include_bytes!("../../../lab/fixtures/price-measure/lab-non_positive.bin"),
            "negative_price" => {
                include_bytes!("../../../lab/fixtures/price-measure/lab-negative_price.bin")
            }
            _ => panic!("unknown fixture"),
        }
    }

    #[test]
    fn fresh_narrow_ok() {
        let data = lab("fresh_narrow");
        // publish_time = 1788179741
        let r = read_price_update(data, &OWNER, &OWNER, &FEED, 1788179741, 3600, 200).unwrap();
        assert_eq!(r.price, 15_000_000_000);
        assert_eq!(r.conf, 50_000);
        assert_eq!(r.expo, -8);
        assert_eq!(price_to_usd_1e8(r.price, r.expo).unwrap(), 15_000_000_000);
    }

    #[test]
    fn stale_refuses() {
        let data = lab("stale");
        // publish 1787179741; now far ahead
        let e = read_price_update(data, &OWNER, &OWNER, &FEED, 1788179741, 3600, 200).unwrap_err();
        assert_eq!(e, KargainError::StalePrice);
        assert_eq!(e.name(), "StalePrice");
    }

    #[test]
    fn wide_conf_named() {
        let data = lab("wide_conf");
        let e = read_price_update(data, &OWNER, &OWNER, &FEED, 1788179741, 3600, 200).unwrap_err();
        assert_eq!(e, KargainError::ConfidenceTooWide);
        assert_eq!(e.name(), "ConfidenceTooWide");
    }

    #[test]
    fn non_positive_bad_oracle() {
        let data = lab("non_positive");
        let e = read_price_update(data, &OWNER, &OWNER, &FEED, 1788179741, 3600, 200).unwrap_err();
        assert_eq!(e, KargainError::BadOracleAnswer);
    }

    #[test]
    fn negative_price_bad_oracle() {
        let data = lab("negative_price");
        let e = read_price_update(data, &OWNER, &OWNER, &FEED, 1788179741, 3600, 200).unwrap_err();
        assert_eq!(e, KargainError::BadOracleAnswer);
    }

    #[test]
    fn wrong_owner_invalid_feed() {
        let data = lab("fresh_narrow");
        let other = [9u8; 32];
        let e = read_price_update(data, &other, &OWNER, &FEED, 1788179741, 3600, 200).unwrap_err();
        assert_eq!(e, KargainError::InvalidFeed);
    }

    #[test]
    fn usd_to_token_usdc_peg() {
        // $100.00 = 100e8; USDC/USD ≈ 1e8; 6 decimals → 100_000_000
        let amt = usd_1e8_to_asset_amount(100 * 100_000_000, 100_000_000, 6).unwrap();
        assert_eq!(amt, 100_000_000);
    }

    #[test]
    fn publish_far_ahead_bad_oracle() {
        let data = lab("fresh_narrow");
        // publish 1788179741; now much earlier
        let e = read_price_update(data, &OWNER, &OWNER, &FEED, 1_000_000_000, 3600, 200).unwrap_err();
        assert_eq!(e, KargainError::BadOracleAnswer);
    }
}
