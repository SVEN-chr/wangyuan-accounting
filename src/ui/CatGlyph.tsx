import type { CatShape } from "../ledgerCommands";

export function CatGlyph({
  shape,
  color,
  size = 14,
  className = "",
}: {
  shape: CatShape;
  color: string;
  size?: number;
  className?: string;
}) {
  const sharedStyle = {
    display: "inline-block",
    flexShrink: 0,
  } as const;

  if (shape === "circle") {
    return (
      <span
        className={className}
        style={{
          ...sharedStyle,
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
        }}
      />
    );
  }
  if (shape === "diamond") {
    return (
      <span
        className={className}
        style={{
          ...sharedStyle,
          width: size,
          height: size,
          background: color,
          transform: "rotate(45deg)",
        }}
      />
    );
  }
  if (shape === "triangle") {
    return (
      <span
        className={className}
        style={{
          ...sharedStyle,
          width: 0,
          height: 0,
          borderLeft: `${size / 2}px solid transparent`,
          borderRight: `${size / 2}px solid transparent`,
          borderBottom: `${size}px solid ${color}`,
        }}
      />
    );
  }
  if (shape === "halfcircle") {
    return (
      <span
        className={className}
        style={{
          ...sharedStyle,
          width: size,
          height: size / 2,
          background: color,
          borderRadius: `${size}px ${size}px 0 0`,
        }}
      />
    );
  }
  return (
    <span
      className={className}
      style={{
        ...sharedStyle,
        width: size,
        height: size,
        background: color,
        borderRadius: 2,
      }}
    />
  );
}
