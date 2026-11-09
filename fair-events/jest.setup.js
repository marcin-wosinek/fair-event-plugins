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

// @wordpress/components 44's CommonJS build has a circular import:
// base-control/index.cjs requires ./hooks.cjs, which requires ./index.cjs back
// and snapshots its (still empty) exports via `__toESM`. BaseControl is then
// `undefined` inside useBaseControlProps, and every ToggleGroupControl render
// throws "Invalid value used as weak map key" from useInstanceId. Loading
// hooks.cjs first lets index.cjs finish before the snapshot is taken.
// Browsers use the single wp.components script and are unaffected.
require(
	require( 'path' ).join(
		require( 'path' ).dirname( require.resolve( '@wordpress/components' ) ),
		'base-control/hooks.cjs'
	)
);
