import React from "react";

// One shared object-fit:cover photo tile, replacing three independently
// hardcoded copies of the same logic (Directory's 160px rect card photo,
// Partner Detail's 160px circle, the Map popup's 176px circle). A missing
// src renders the same empty background-colored placeholder every call site
// already fell back to -- not a silhouette icon (that's maskData.js's job
// server-side for restricted partners, which this component has no opinion
// on; it just renders whatever src it's given, or nothing).
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
      className={className}
      style={style}
      onError={(e) => {
        e.target.style.display = "none";
      }}
    />
  );
}
