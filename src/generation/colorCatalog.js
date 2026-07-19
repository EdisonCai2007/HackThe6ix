export const LDRAW_COLORS = Object.freeze({
  black: { color_name: "black", color_id: "0", hex: 0x05131d },
  blue: { color_name: "blue", color_id: "1", hex: 0x0055bf },
  green: { color_name: "green", color_id: "2", hex: 0x237841 },
  red: { color_name: "red", color_id: "4", hex: 0xc91a09 },
  brown: { color_name: "brown", color_id: "6", hex: 0x583927 },
  yellow: { color_name: "yellow", color_id: "14", hex: 0xf2cd37 },
  white: { color_name: "white", color_id: "15", hex: 0xffffff },
  beige: { color_name: "beige", color_id: "19", hex: 0xe4cd9e },
  orange: { color_name: "orange", color_id: "25", hex: 0xfe8a18 },
  light_gray: { color_name: "light gray", color_id: "71", hex: 0xa0a5a9 },
  dark_gray: { color_name: "dark gray", color_id: "72", hex: 0x6c6e68 },
  dark_green: { color_name: "dark green", color_id: "288", hex: 0x184632 },
  translucent_light_blue: {
    color_name: "translucent light blue",
    color_id: "43",
    hex: 0xaeefec,
  },
});

export const COLOR_HEX_BY_ID = Object.freeze(
  Object.fromEntries(
    Object.values(LDRAW_COLORS).map(({ color_id, hex }) => [color_id, hex]),
  ),
);

function colorKey(colorName) {
  return String(colorName).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
}

export function getLDrawColor(colorName) {
  return LDRAW_COLORS[colorKey(colorName)] ?? null;
}
