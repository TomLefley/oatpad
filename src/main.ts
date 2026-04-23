import { mount } from "svelte";
import App from "./App.svelte";
import * as store from "./lib/store.svelte";
import { loadTheme, applyTheme } from "./lib/theme";
import "@fontsource-variable/manrope";
import "@fontsource/poppins/600.css";
import "quill/dist/quill.bubble.css";
import "./app.css";

applyTheme(loadTheme());
store.initSession();

const target = document.getElementById("app");
if (!target) throw new Error("#app not found");

const app = mount(App, { target });

export default app;
