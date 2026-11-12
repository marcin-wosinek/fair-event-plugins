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

/**
 * The upgrade checklist (PAYMENT_HISTORY_MIGRATION.md §8.17): what each
 * condition means and what to do when it isn't met.
 *
 * @return {Object<string, {label: string, action: string}>} Labels by check code.
 */
export function upgradeCheckLabels() {
	return {
		completion_recorded: {
			label: __( 'Completion recorded on this site', 'fair-events' ),
			action: __(
				'Recorded automatically once every other condition holds.',
				'fair-events'
			),
		},
		migration_verified: {
			label: __( 'Migration verified', 'fair-events' ),
			action: __(
				'Run the migration and verify it until the report is clean.',
				'fair-events'
			),
		},
		ownership_cutover: {
			label: __(
				'Payment records switched to Fair Events',
				'fair-events'
			),
			action: __(
				'Switch payment records to Fair Events on this page.',
				'fair-events'
			),
		},
		readers_switched: {
			label: __( 'Statistics switched to Fair Events', 'fair-events' ),
			action: __(
				'Switch statistics to Fair Events on this page.',
				'fair-events'
			),
		},
		no_migration_work: {
			label: __( 'No payment records waiting to move', 'fair-events' ),
			action: __(
				'Wait for the queued records to be retried, or fix what stops them.',
				'fair-events'
			),
		},
		no_blocking_finding: {
			label: __( 'No open findings', 'fair-events' ),
			action: __(
				'Link or review every open finding. Findings marked “for review only” don’t count.',
				'fair-events'
			),
		},
	};
}

/**
 * Why the source-history cleanup can't run yet.
 *
 * @return {Object<string, string>} Labels by blocker code.
 */
export function cleanupBlockerLabels() {
	return {
		upgrade_unsafe: __(
			'The site isn’t safe to upgrade yet (see the checklist).',
			'fair-events'
		),
		migration_work_outstanding: __(
			'Payment records are still waiting to move.',
			'fair-events'
		),
		findings_open: __( 'Findings are still open.', 'fair-events' ),
		staging_verification_incomplete: __(
			'The staging verification isn’t recorded with every check passed.',
			'fair-events'
		),
		cleanup_unavailable: __(
			'Removing the old records comes with a later release.',
			'fair-events'
		),
	};
}

/**
 * The final verification checks an operator records from staging
 * (PAYMENT_HISTORY_MIGRATION.md §8.15).
 *
 * @return {Object<string, {label: string, help: string}>} Labels by check code.
 */
export function stagingCheckLabels() {
	return {
		representative_purchases: {
			label: __( 'Representative purchases checked', 'fair-events' ),
			help: __(
				'A paid single purchase, a retried purchase, a payment shared by several dates, and a series pass with its dates.',
				'fair-events'
			),
		},
		statistics_revenue: {
			label: __( 'Statistics match the linked payments', 'fair-events' ),
			help: __(
				'For each sampled date, Statistics revenue equals the counted shares in its Purchase payments section, minus series pass revenue on the series’ other dates.',
				'fair-events'
			),
		},
		shared_allocations: {
			label: __( 'Shared payments add up', 'fair-events' ),
			help: __(
				'The payment’s page lists every purchase it covers, and their shares add up to its total.',
				'fair-events'
			),
		},
		finance_participant_attempts: {
			label: __(
				'Finance and participant payments agree',
				'fair-events'
			),
			help: __(
				'A purchaser’s participant page lists the same payment attempts as the date’s Finance tab.',
				'fair-events'
			),
		},
		audience_reactivation: {
			label: __(
				'Unchanged after reactivating Fair Audience',
				'fair-events'
			),
			help: __(
				'Deactivating and reactivating Fair Audience leaves Statistics, ticket payment history and the payment’s purchases unchanged.',
				'fair-events'
			),
		},
	};
}
