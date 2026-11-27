import React from "react";

// One shared object-fit:cover photo tile. A missing src renders an empty background-colored
// placeholder, not a silhouette (that is maskData.js's job server-side for restricted partners).
export default function PhotoTile({
  src,
  alt = "",
  shape = "circle",
  size = 160,
  fluidWidth = false,
  className,
}) {
  const style = {
    width: fluidWidth ? "100%" : size,
    height: size,
    objectFit: "cover",
    background: "var(--surface-2)",
    display: "block",
    flexShrink: 0,
    ...(shape === "circle" ? { borderRadius: "50%" } : {}),
  };

  if (!src) return <div className={className} style={style} />;

  return (
    <img
      src={src}
      alt={alt}
      // Below the first screen it isn't fetched until it is about to be seen, and it is decoded off the main thread.
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
      onError={(e) => {
        e.target.style.display = "none";
      }}
    />
  );
}
