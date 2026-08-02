/** The shuriken mark, used in the header and the empty state. */
export function ShurikenMark({ size = 16, id }: { size?: number; id: string }) {
  const gradientId = `shuriken-gradient-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M16 2 L20 12 L30 16 L20 20 L16 30 L12 20 L2 16 L12 12 Z" fill={`url(#${gradientId})`} />
      <circle cx="16" cy="16" r="3.2" fill="#0b0b14" />
      <defs>
        <linearGradient id={gradientId} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5c518" />
          <stop offset="1" stopColor="#e63b2e" />
        </linearGradient>
      </defs>
    </svg>
  );
}
