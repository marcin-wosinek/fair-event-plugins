/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';

/**
 * Read-only description of a bank-imported entry's origin.
 *
 * @param {Object|null} bankOrigin The entry's `bank_origin`, from the API.
 * @return {string|null} Label, or null for an entry that is not a bank import.
 */
export const bankOriginLabel = ( bankOrigin ) => {
	if ( ! bankOrigin ) {
		return null;
	}

	if ( bankOrigin.account?.name ) {
		return sprintf(
			/* translators: %s: bank account name */
			__( 'Bank import — %s', 'fair-finance' ),
			bankOrigin.account.name
		);
	}

	return __( 'Bank import — account unknown', 'fair-finance' );
};

/**
 * Explanation for a bank import that still carries a payment source it was
 * given before bank imports were protected.
 *
 * @param {Object} entry Financial entry with `bank_origin`.
 * @return {string|null} Notice text, or null when there is no conflict.
 */
export const legacyClassificationNotice = ( entry ) => {
	if ( ! entry?.bank_origin || ! entry.payment_source ) {
		return null;
	}

	if ( 'personal_funds' === entry.payment_source ) {
		return sprintf(
			/* translators: %s: name of the person recorded as having paid */
			__(
				'This bank import was recorded as paid from personal funds by %s before bank imports were protected. That record is kept as it is and cannot be changed here.',
				'fair-finance'
			),
			entry.payer_name || __( '(unnamed)', 'fair-finance' )
		);
	}

	return __(
		'This bank import was recorded as event cash before bank imports were protected. That record is kept as it is and cannot be changed here.',
		'fair-finance'
	);
};
