export type TabNavigationKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function nextTabIndex(key: string, currentIndex: number, total: number) {
  if (total <= 0 || currentIndex < 0 || currentIndex >= total) return null;
  if (key === "ArrowRight") return (currentIndex + 1) % total;
  if (key === "ArrowLeft") return (currentIndex - 1 + total) % total;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  return null;
}
