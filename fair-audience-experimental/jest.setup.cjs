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
