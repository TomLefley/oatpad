import { mount } from "svelte";
import App from "./App.svelte";
import "./lib/platform";
import * as store from "./lib/store.svelte";
import { loadTheme, applyTheme } from "./lib/theme";
import { loadParagraphGap, applyParagraphGap } from "./lib/paragraphGap";
import "@fontsource-variable/manrope";
import "@fontsource/poppins/600.css";
import "quill/dist/quill.bubble.css";
import "./app.css";

applyTheme(loadTheme());
applyParagraphGap(loadParagraphGap());

const target = document.getElementById("app");
if (!target) throw new Error("#app not found");

await store.initMeeting();

const app = mount(App, { target });

export default app;
