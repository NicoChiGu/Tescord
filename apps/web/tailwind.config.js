/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        discord: {
          sidebar: "#1e1f22",
          channelList: "#2b2d31",
          chat: "#313338",
          hover: "#35373c",
          active: "#404249",
          brand: "#5865f2",
          "brand-hover": "#4752c4",
          green: "#23a55a",
          danger: "#f23f43",
          textMuted: "#949ba4",
          textNormal: "#dbdee1",
          textHeader: "#f2f3f5",
        },
      },
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-left": "env(safe-area-inset-left)",
        "safe-right": "env(safe-area-inset-right)",
      },
      height: {
        dvh: "100dvh",
        svh: "100svh",
        lvh: "100lvh",
      },
    },
  },
  plugins: [],
};
