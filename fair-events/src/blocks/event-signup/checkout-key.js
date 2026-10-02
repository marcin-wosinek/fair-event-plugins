/**
 * Idempotency key of the Event Signup form's checkout.
 *
 * One key stands for one intended purchase: the server answers a request
 * repeated with the same key with the purchase it already created, instead
 * of creating — and charging — another one. The key is therefore kept while
 * the same purchase is being submitted (a second click, a retry after a
 * network error, a resubmission after coming back from the payment page) and
 * replaced only when another purchase begins.
 *
 * @package FairEvents
 */

// The fields that describe what is being bought and by whom. Credentials,
// tracking identifiers and the honeypot do not start another purchase.
const PURCHASE_FIELDS = [
	'event_date_id',
	'name',
	'email',
	'ticket_type_id',
	'quantity',
	'event_date_ids',
	'ticket_option_ids',
	'ticket_activities',
	'mailing_opt_in',
	'questionnaire_answers',
];

/**
 * Generate a cryptographically random key.
 * @return {string} 32 hexadecimal characters.
 */
export function generateCheckoutKey() {
	const bytes = new Uint8Array( 16 );
	window.crypto.getRandomValues( bytes );
	return Array.from( bytes, ( byte ) =>
		byte.toString( 16 ).padStart( 2, '0' )
	).join( '' );
}

/**
 * Reduce a request payload to the details that identify its purchase.
 * @param {Object} data Request payload.
 * @return {string} Comparable signature.
 */
export function purchaseSignature( data ) {
	return JSON.stringify(
		PURCHASE_FIELDS.map( ( field ) => data[ field ] ?? null )
	);
}

/**
 * Keep one form's checkout key across submissions of the same purchase.
 * @param {Function} [generate] Key generator, replaceable in tests.
 * @return {{keyFor: Function, reset: Function}} Key store.
 */
export function createCheckoutKeyStore( generate = generateCheckoutKey ) {
	let key = null;
	let signature = null;

	return {
		/**
		 * The key to send with a payload: the current one while the purchase
		 * details are unchanged, a new one once they differ.
		 * @param {Object} data Request payload.
		 * @return {string} Idempotency key.
		 */
		keyFor( data ) {
			const next = purchaseSignature( data );
			if ( ! key || next !== signature ) {
				key = generate();
				signature = next;
			}
			return key;
		},

		/**
		 * Forget the key, so the next submission begins a new purchase.
		 */
		reset() {
			key = null;
			signature = null;
		},
	};
}
