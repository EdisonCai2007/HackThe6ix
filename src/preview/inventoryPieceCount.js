export function countInventoryBricks(inventory) {
  return (inventory?.items ?? []).reduce((total, item) => {
    if (!item?.supported || !Number.isFinite(item.count)) {
      return total;
    }

    return total + Math.max(0, Math.floor(item.count));
  }, 0);
}
