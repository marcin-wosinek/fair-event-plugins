// jsdom does not implement `CSS.supports()`, which @ariakit/react (used by
// @wordpress/dataviews' menus/popovers) calls for feature detection when
// mounting. Without this, any test that opens an Ariakit-backed dropdown
// throws "CSS.supports is not a function".
if ( typeof window !== 'undefined' ) {
	window.CSS = window.CSS || {};
	if ( typeof window.CSS.supports !== 'function' ) {
		window.CSS.supports = () => false;
	}
}

// jsdom does not implement `ResizeObserver`, which the @wordpress/dataviews
// table layout (22.0.0+) uses on its <thead>. Without this, every test that
// renders a DataViews table throws "ResizeObserver is not defined".
if ( typeof globalThis.ResizeObserver === 'undefined' ) {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
