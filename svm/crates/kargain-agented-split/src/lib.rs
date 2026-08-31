//! Sole S32 agented-split arithmetic.
//!
//! Bit-exact with `ConsignmentBase._computeAgentedSplitAmounts` and
//! `lib/commerce/agented-split.ts`. Platform floored first; Margin owner = floor
//! and agent = residual; Commission owner = floored kept rate and agent = residual.
//! `ok == false` ≡ Solidity `BelowFloor`.

use kargain_errors::KargainError;

pub const BPS_DENOM: u64 = 10_000;

/// Compensation form ordinals match Solidity `CompensationForm`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CompensationForm {
    Margin = 0,
    Commission = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentedSplit {
    pub platform: u64,
    pub owner_amount: u64,
    pub agent_amount: u64,
    pub ok: bool,
}

fn agented_floor_scale_base(
    settled: u64,
    form: CompensationForm,
    commission_bps: u16,
    platform_fee_bps: u64,
) -> Result<u64, KargainError> {
    // Intermediate product in u128 — same domain as Solidity uint256 fee maths (no
    // artificial u64 overflow refusal for legal EVM inputs).
    let platform = ((u128::from(settled) * u128::from(platform_fee_bps))
        / u128::from(BPS_DENOM)) as u64;
    match form {
        CompensationForm::Margin => settled
            .checked_sub(platform)
            .ok_or(KargainError::ArithmeticOverflow),
        CompensationForm::Commission => {
            let cut_bps = platform_fee_bps
                .checked_add(u64::from(commission_bps))
                .ok_or(KargainError::ArithmeticOverflow)?;
            if cut_bps >= BPS_DENOM {
                return Ok(0);
            }
            let kept = BPS_DENOM
                .checked_sub(cut_bps)
                .ok_or(KargainError::ArithmeticOverflow)?;
            Ok(((u128::from(settled) * u128::from(kept)) / u128::from(BPS_DENOM)) as u64)
        }
    }
}

/// Mirrors Solidity `_computeAgentedSplitAmounts` (does not revert — `ok` is BelowFloor).
pub fn compute_agented_split(
    settled: u64,
    floor: u64,
    form: CompensationForm,
    commission_bps: u16,
    platform_fee_bps: u64,
) -> Result<AgentedSplit, KargainError> {
    let platform = ((u128::from(settled) * u128::from(platform_fee_bps))
        / u128::from(BPS_DENOM)) as u64;

    match form {
        CompensationForm::Margin => {
            let scale = agented_floor_scale_base(
                settled,
                form,
                commission_bps,
                platform_fee_bps,
            )?;
            let ok = floor <= scale;
            if ok {
                let agent_amount = settled
                    .checked_sub(platform)
                    .ok_or(KargainError::ArithmeticOverflow)?
                    .checked_sub(floor)
                    .ok_or(KargainError::ArithmeticOverflow)?;
                Ok(AgentedSplit {
                    platform,
                    owner_amount: floor,
                    agent_amount,
                    ok: true,
                })
            } else {
                Ok(AgentedSplit {
                    platform,
                    owner_amount: 0,
                    agent_amount: 0,
                    ok: false,
                })
            }
        }
        CompensationForm::Commission => {
            let owner_amount = agented_floor_scale_base(
                settled,
                form,
                commission_bps,
                platform_fee_bps,
            )?;
            if settled < platform.saturating_add(owner_amount) {
                return Ok(AgentedSplit {
                    platform,
                    owner_amount: 0,
                    agent_amount: 0,
                    ok: false,
                });
            }
            let agent_amount = settled
                .checked_sub(platform)
                .ok_or(KargainError::ArithmeticOverflow)?
                .checked_sub(owner_amount)
                .ok_or(KargainError::ArithmeticOverflow)?;
            // Match TS mirror: keep computed legs when sole failure is floor (Solidity reverts).
            Ok(AgentedSplit {
                platform,
                owner_amount,
                agent_amount,
                ok: owner_amount >= floor,
            })
        }
    }
}

/// Direct (unagented) split — platform floored share, owner remainder. No floor.
pub fn compute_direct_split(settled: u64, platform_fee_bps: u64) -> Result<AgentedSplit, KargainError> {
    let platform = ((u128::from(settled) * u128::from(platform_fee_bps)) / u128::from(BPS_DENOM)) as u64;
    let owner_amount = settled
        .checked_sub(platform)
        .ok_or(KargainError::ArithmeticOverflow)?;
    Ok(AgentedSplit {
        platform,
        owner_amount,
        agent_amount: 0,
        ok: true,
    })
}

/// Same maths; reverts with [`KargainError::BelowFloor`] when `ok` is false.
pub fn compute_agented_split_or_revert(
    settled: u64,
    floor: u64,
    form: CompensationForm,
    commission_bps: u16,
    platform_fee_bps: u64,
) -> Result<AgentedSplit, KargainError> {
    let split = compute_agented_split(settled, floor, form, commission_bps, platform_fee_bps)?;
    if !split.ok {
        return Err(KargainError::BelowFloor);
    }
    Ok(split)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Vector {
        id: String,
        settled: String,
        floor: String,
        form: String,
        #[serde(rename = "commissionBps")]
        commission_bps: u16,
        #[serde(rename = "platformFeeBps")]
        platform_fee_bps: String,
        ok: bool,
        platform: String,
        #[serde(rename = "ownerAmount")]
        owner_amount: String,
        #[serde(rename = "agentAmount")]
        agent_amount: String,
    }

    fn parse_u64(s: &str) -> u64 {
        s.parse().expect("u64")
    }

    #[test]
    fn corpus_bit_exact() {
        let raw = include_str!("../fixtures/vectors.json");
        let vectors: Vec<Vector> = serde_json::from_str(raw).expect("vectors.json");
        assert!(vectors.len() >= 10, "corpus too small");
        for v in &vectors {
            let form = match v.form.as_str() {
                "margin" => CompensationForm::Margin,
                "commission" => CompensationForm::Commission,
                other => panic!("unknown form {other}"),
            };
            let got = compute_agented_split(
                parse_u64(&v.settled),
                parse_u64(&v.floor),
                form,
                v.commission_bps,
                parse_u64(&v.platform_fee_bps),
            )
            .unwrap_or_else(|e| panic!("{}: {e}", v.id));
            assert_eq!(got.ok, v.ok, "{} ok", v.id);
            assert_eq!(got.platform, parse_u64(&v.platform), "{} platform", v.id);
            assert_eq!(
                got.owner_amount,
                parse_u64(&v.owner_amount),
                "{} owner",
                v.id
            );
            assert_eq!(
                got.agent_amount,
                parse_u64(&v.agent_amount),
                "{} agent",
                v.id
            );
        }
    }

    #[test]
    fn below_floor_reverts_by_name() {
        assert_eq!(
            compute_agented_split_or_revert(1000, 976, CompensationForm::Margin, 0, 250),
            Err(KargainError::BelowFloor)
        );
    }

    #[test]
    fn zero_agent_leg_ok() {
        let s = compute_agented_split(1000, 975, CompensationForm::Margin, 0, 250).unwrap();
        assert!(s.ok);
        assert_eq!(s.agent_amount, 0);
    }

    #[test]
    fn former_u64_checked_mul_boundary_does_not_refuse() {
        let settled = (u64::MAX / 250).saturating_add(1);
        assert!(settled.checked_mul(250).is_none(), "fixture must overflow u64 mul");
        let s = compute_agented_split(settled, 0, CompensationForm::Margin, 0, 250).unwrap();
        assert!(s.ok);
        assert_eq!(s.platform, ((settled as u128 * 250) / 10_000) as u64);
    }
}
