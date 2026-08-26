/**
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * localhost). On a plain-HTTP install — common for self-hosted staging —
 * it is `undefined`, so block editors that call it directly throw and never
 * assign an id. Fall back to `crypto.getRandomValues()`, which is available
 * more broadly, to build a UUIDv4 by hand.
 */

/**
 * Generate a UUIDv4 string, preferring the native `crypto.randomUUID()` and
 * falling back to `crypto.getRandomValues()` when it isn't available.
 *
 * @return {string} A UUIDv4 string.
 */
export function generateUuid() {
	if ( typeof crypto.randomUUID === 'function' ) {
		return crypto.randomUUID();
	}

	const bytes = crypto.getRandomValues( new Uint8Array( 16 ) );
	bytes[ 6 ] = ( bytes[ 6 ] & 0x0f ) | 0x40;
	bytes[ 8 ] = ( bytes[ 8 ] & 0x3f ) | 0x80;

	const hex = Array.from( bytes, ( byte ) =>
		byte.toString( 16 ).padStart( 2, '0' )
	).join( '' );

	return [
		hex.slice( 0, 8 ),
		hex.slice( 8, 12 ),
		hex.slice( 12, 16 ),
		hex.slice( 16, 20 ),
		hex.slice( 20, 32 ),
	].join( '-' );
}
