// URL for a product's photo, or null if it has none. imageVersion changes
// whenever the photo does, so the browser can cache each URL forever.
export function productImageUrl(product) {
  if (!product?._id || !product.hasImage) return null;
  return `/api/proxy/products/${product._id}/image?v=${product.imageVersion || 0}`;
}
