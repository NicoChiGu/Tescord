/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "context-menu-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "context-menu-out": {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.96)" },
        },
        "indeterminate-bar": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
      },
      animation: {
        "context-menu-in":
          "context-menu-in 110ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "context-menu-out":
          "context-menu-out 85ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "indeterminate-bar":
          "indeterminate-bar 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
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
