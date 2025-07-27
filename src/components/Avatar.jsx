export default function Avatar({ name, size = 48 }) {
  const initials = name
    .split(" ")
    .map(word => word[0])
    .join("")
    .toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: "#ec4899", // Tailwind pink-500
        color: "white",
        fontWeight: "bold",
        fontSize: size / 2.5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "12px", // not fully rounded
        userSelect: "none"
      }}
    >
      {initials}
    </div>
  );
}
