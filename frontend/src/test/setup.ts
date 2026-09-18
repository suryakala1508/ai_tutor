import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement Element.scrollTo — polyfill it as a no-op so
// components that auto-scroll a chat/list container (e.g. TutorPage) don't
// crash when rendered in tests.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
