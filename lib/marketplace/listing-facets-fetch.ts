export type ListingFacetsFetchOpenState = {
  priceOpen: boolean;
  makeOpen: boolean;
  fuelOpen: boolean;
  drawerOpen: boolean;
};

export function shouldFetchListingFacets(state: ListingFacetsFetchOpenState): boolean {
  return state.priceOpen || state.makeOpen || state.fuelOpen || state.drawerOpen;
}
