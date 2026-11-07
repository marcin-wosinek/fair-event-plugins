/**
 * Display names for the payment history migration's codes. The REST API
 * returns stable codes (PAYMENT_HISTORY_MIGRATION.md §6.2, §8.9); these
 * are what an organizer reads.
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';

/**
 * Why a record was reported, with what an administrator can do about it.
 *
 * @return {Object<string, {label: string, description: string}>} Labels by reason code.
 */
export function reasonLabels() {
	return {
		no_evidence: {
			label: __( 'Payment without a purchase', 'fair-events' ),
			description: __(
				'The payment records name no purchase that still exists, so it can’t be linked automatically.',
				'fair-events'
			),
		},
		allocation_mismatch: {
			label: __( 'Shared payment doesn’t add up', 'fair-events' ),
			description: __(
				'The payment covers several purchases, but their amounts don’t add up to its total.',
				'fair-events'
			),
		},
		amount_mismatch: {
			label: __( 'Amount differs from the purchase', 'fair-events' ),
			description: __(
				'The payment was linked, but its total differs from the purchase’s own amount. For review only.',
				'fair-events'
			),
		},
		ambiguous_activity: {
			label: __( 'Activity with no clear ticket', 'fair-events' ),
			description: __(
				'An activity was chosen for a person who holds no ticket, or several, on this date.',
				'fair-events'
			),
		},
		ambiguous_activity_charge: {
			label: __(
				'Activity payment with no clear purchase',
				'fair-events'
			),
			description: __(
				'An activity payment could belong to none or several of the person’s purchases.',
				'fair-events'
			),
		},
		ambiguous_upgrade: {
			label: __( 'Series upgrade with no clear purchase', 'fair-events' ),
			description: __(
				'A series upgrade payment could belong to none or several of the person’s purchases.',
				'fair-events'
			),
		},
		duplicate_series_relationship: {
			label: __( 'Duplicate of a series pass', 'fair-events' ),
			description: __(
				'A registration on one session repeats a series pass that already covers it.',
				'fair-events'
			),
		},
		multiple_paid_attempts: {
			label: __( 'Paid more than once', 'fair-events' ),
			description: __(
				'More than one payment for the same purchase was completed. All of them count. For review only.',
				'fair-events'
			),
		},
		missing_transaction: {
			label: __( 'Payment no longer exists', 'fair-events' ),
			description: __(
				'A record names a payment that was deleted from Fair Payments Connector.',
				'fair-events'
			),
		},
		currency_mismatch: {
			label: __( 'Currencies don’t match', 'fair-events' ),
			description: __(
				'Records sharing one payment use different currencies.',
				'fair-events'
			),
		},
		unsupported_refund_record: {
			label: __( 'Refund record kept', 'fair-events' ),
			description: __(
				'An old refund entry is kept as it was and never counts as revenue. For review only.',
				'fair-events'
			),
		},
		participant_relationship_conflict: {
			label: __( 'Payment recorded for different people', 'fair-events' ),
			description: __(
				'One payment was recorded against registrations of different people.',
				'fair-events'
			),
		},
		existing_link_conflict: {
			label: __( 'Conflicts with existing links', 'fair-events' ),
			description: __(
				'The payment records point to purchases, but links already recorded for this payment leave no room for them.',
				'fair-events'
			),
		},
	};
}

/**
 * Label of a reason, falling back to its code.
 *
 * @param {string} reason Reason code.
 * @return {string} Label.
 */
export function reasonLabel( reason ) {
	return reasonLabels()[ reason ]?.label ?? reason;
}

/**
 * Finding statuses.
 *
 * @return {Object<string, string>} Labels by status.
 */
export function findingStatusLabels() {
	return {
		open: __( 'Needs a decision', 'fair-events' ),
		resolved: __( 'Resolved by a later pass', 'fair-events' ),
		reconciled: __( 'Linked by an administrator', 'fair-events' ),
		reviewed: __( 'Reviewed, no link', 'fair-events' ),
	};
}

/**
 * What stops the migration from starting or continuing.
 *
 * @return {Object<string, string>} Explanations by blocker code.
 */
export function blockerLabels() {
	return {
		storage_unavailable: __(
			'Fair Events hasn’t finished updating its database yet. Reload the page in a moment.',
			'fair-events'
		),
		shadow_writes_incomplete: __(
			'New payments aren’t recorded in Fair Events yet. Update Fair Audience and Fair Payments Connector to their latest versions.',
			'fair-events'
		),
		payment_information_unavailable: __(
			'Payment information can’t be read because Fair Payments Connector is inactive or not installed.',
			'fair-events'
		),
		audience_incompatible: __(
			'Fair Audience is too old: it would count migrated tickets twice. Update Fair Audience first.',
			'fair-events'
		),
	};
}

/**
 * What stops payment records from switching to Fair Events.
 *
 * @return {Object<string, string>} Explanations by blocker code.
 */
export function cutoverBlockerLabels() {
	return {
		...blockerLabels(),
		migration_unverified: __(
			'The migration hasn’t been verified yet. Finish it and pass its verification first.',
			'fair-events'
		),
		audience_lifecycle_unavailable: __(
			'Fair Audience is too old to record its payments in Fair Events. Update Fair Audience first.',
			'fair-events'
		),
		shadow_work_outstanding: __(
			'Some recent payments are still waiting to be recorded. They are retried automatically every fifteen minutes.',
			'fair-events'
		),
	};
}

/**
 * What needs fixing after payment records switched to Fair Events. None of
 * these switches them back.
 *
 * @return {Object<string, string>} Explanations by issue code.
 */
export function cutoverIssueLabels() {
	return {
		storage_unavailable: __(
			'Fair Events can’t read its payment records: its database update is incomplete or it was rolled back. Update Fair Events to its latest version.',
			'fair-events'
		),
		audience_lifecycle_unavailable: __(
			'Fair Audience is too old: its purchases are no longer recorded in Fair Events. Update Fair Audience to its latest version.',
			'fair-events'
		),
		payment_information_unavailable: __(
			'Payment information can’t be read because Fair Payments Connector is inactive or not installed. Payments arriving now are recorded once it is back.',
			'fair-events'
		),
		verification_failed: __(
			'The last verification found problems. Fix them and verify again; payment records keep using Fair Events.',
			'fair-events'
		),
	};
}

/**
 * Queued work, by kind.
 *
 * @return {Object<string, string>} Labels by work kind.
 */
export function workKindLabels() {
	return {
		transaction: __( 'Payments to link', 'fair-events' ),
		relationship: __( 'Registrations to follow', 'fair-events' ),
		payment: __( 'Payment updates to apply', 'fair-events' ),
		confirmation: __( 'Confirmations to announce', 'fair-events' ),
		projection: __( 'Updates to pass to Fair Audience', 'fair-events' ),
	};
}

/**
 * What stops verification from passing.
 *
 * @return {Object<string, string>} Explanations by verification blocker code.
 */
export function verificationBlockerLabels() {
	return {
		unexpected_differences: __(
			'Some event dates differ in ways the migration can’t explain.',
			'fair-events'
		),
		shadow_work_outstanding: __(
			'Some recent payments are still waiting to be recorded.',
			'fair-events'
		),
		allocation_exceeds_total: __(
			'Some payments are linked for more than their total.',
			'fair-events'
		),
		unlisted_paid_transactions: __(
			'Some paid event payments are neither linked nor listed for review.',
			'fair-events'
		),
		payment_information_unavailable: __(
			'Payment information can’t be read because Fair Payments Connector is inactive or not installed.',
			'fair-events'
		),
	};
}

/**
 * Steps of a run.
 *
 * @return {Object<string, string>} Labels by phase.
 */
export function phaseLabels() {
	return {
		admissions: __( 'Registrations', 'fair-events' ),
		activities: __( 'Activities', 'fair-events' ),
		transactions: __( 'Payments', 'fair-events' ),
		references: __( 'Refund and deleted-payment records', 'fair-events' ),
		signup_references: __(
			'Purchases naming deleted payments',
			'fair-events'
		),
		revisit_admissions: __( 'Second look at registrations', 'fair-events' ),
		revisit_findings: __(
			'Second look at reported records',
			'fair-events'
		),
		verify: __( 'Verification', 'fair-events' ),
		summary: __( 'Summary', 'fair-events' ),
	};
}

/**
 * Roles of a payment link.
 *
 * @return {Object<string, string>} Labels by role.
 */
export function roleLabels() {
	return {
		charge: __( 'Purchase price', 'fair-events' ),
		additional_charge: __( 'Activities added later', 'fair-events' ),
		upgrade: __( 'Series upgrade', 'fair-events' ),
		legacy_refund_record: __( 'Old refund record', 'fair-events' ),
	};
}

/**
 * Who recorded a link.
 *
 * @return {Object<string, string>} Labels by attribution.
 */
export function attributionLabels() {
	return {
		live: __( 'Recorded at payment', 'fair-events' ),
		backfill: __( 'Migrated', 'fair-events' ),
		reconciled: __( 'Linked by an administrator', 'fair-events' ),
	};
}

/**
 * Why a revenue figure differs between the old and new records.
 *
 * @return {Object<string, string>} Labels by cause.
 */
export function revenueCauseLabels() {
	return {
		shared_transaction: __(
			'Shared payment split between dates',
			'fair-events'
		),
		legacy_refund_record: __(
			'Old refund record not counted',
			'fair-events'
		),
		unresolved: __( 'Listed for review', 'fair-events' ),
		reconciled: __( 'Decided by an administrator', 'fair-events' ),
		not_in_ledger: __(
			'Paid, missing from the old records',
			'fair-events'
		),
		unexpected: __( 'Unexplained difference', 'fair-events' ),
	};
}

/**
 * Connector payment statuses.
 *
 * @return {Object<string, string>} Labels by status.
 */
export function transactionStatusLabels() {
	return {
		draft: __( 'Not started', 'fair-events' ),
		pending_payment: __( 'Awaiting payment', 'fair-events' ),
		open: __( 'Awaiting payment', 'fair-events' ),
		pending: __( 'Pending', 'fair-events' ),
		authorized: __( 'Authorized', 'fair-events' ),
		paid: __( 'Paid', 'fair-events' ),
		failed: __( 'Failed', 'fair-events' ),
		canceled: __( 'Canceled', 'fair-events' ),
		expired: __( 'Expired', 'fair-events' ),
		refunded: __( 'Refunded', 'fair-events' ),
		charged_back: __( 'Charged back', 'fair-events' ),
	};
}

/**
 * Purchase statuses.
 *
 * @return {Object<string, string>} Labels by status.
 */
export function purchaseStatusLabels() {
	return {
		confirmed: __( 'Confirmed', 'fair-events' ),
		pending_payment: __( 'Awaiting payment', 'fair-events' ),
		cancelled: __( 'Cancelled', 'fair-events' ),
		expired: __( 'Expired', 'fair-events' ),
		failed: __( 'Payment failed', 'fair-events' ),
	};
}
