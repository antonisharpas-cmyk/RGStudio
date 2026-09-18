import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /* Brand palette sampled directly from the RG Pilates Studio logo:
           a warm greige ground with near black ink. The scale keeps its old
           name so the components did not need retouching; only the values
           changed. */
        mocha: {
          50: "#F8F6F4",
          100: "#F0ECE9",
          200: "#DFD8D3",
          300: "#C6BDB6", // the logo's greige
          400: "#A69B93",
          500: "#7E736A",
          600: "#3A3532", // primary brand ink
          700: "#2C2826",
          800: "#1F1C1A",
          900: "#161413",
          950: "#0E0D0C",
        },
        /* sampled from the studio's own photography: the pale curtains and
           the light on the floor */
        cream: {
          DEFAULT: "#F6F3F0",
          50: "#FBFAF8",
          100: "#F6F3F0",
          200: "#EDE8E4",
          300: "#DFD8D2",
        },
        /* the schedule card's taupe */
        taupe: "#857868",
        /* the greige ground and its lighter and darker neighbours */
        stone: "#A69B93",
        sand: "#C6BDB6",
        clay: "#8F857D",
        gold: "#B8A98F",
      },
      fontFamily: {
        sans: ["var(--font-jost)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-cormorant)", "Georgia", "serif"],
        /* the hero headline, set to echo the wordmark's flared letterforms */
        wordmark: ["var(--font-wordmark)", "var(--font-jost)", "serif"],
      },
      letterSpacing: {
        widest: "0.22em",
        brand: "0.32em",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        soft: "0 20px 60px -30px rgba(58,53,50,0.35)",
        lift: "0 30px 80px -40px rgba(58,53,50,0.55)",
      },
      transitionTimingFunction: {
        silk: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.5" },
          "50%": { transform: "scale(1.06)", opacity: "0.8" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.9s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 1.2s ease both",
        breathe: "breathe 9s ease-in-out infinite",
        marquee: "marquee 38s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
