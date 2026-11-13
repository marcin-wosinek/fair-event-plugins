<?php
/**
 * Payment history reconciliation
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\SignupPaymentLink;
use FairEventsShared\LineItemTotals;

defined( 'WPINC' ) || die;

/**
 * What an administrator does with the payment history records reported
 * for review (PAYMENT_HISTORY_MIGRATION.md §6.3, §8.10):
 *
 * - link a reported transaction to one purchase, or set the allocations of
 *   a shared transaction across several, as `reconciled` links;
 * - remove a link they reconciled;
 * - mark a finding as reviewed, keeping the record without a link.
 *
 * Each action runs under the transaction's link writer lock and in one
 * database transaction with its finding change and an append-only audit
 * record: the change, the finding's new status and the audit land together
 * or not at all. The same allocation rules as every writer apply
 * (PaymentLinkAllocation): the total is never exceeded. An action names the
 * links the administrator saw; when they changed meanwhile, or the finding
 * was decided by someone else, it is refused as stale instead of
 * overwriting the other decision.
 *
 * Only findings of the completed migration (`backfill` mode) are
 * reconciled. The findings list no longer offers dry-run ones, which the
 * source-history cleanup removes (§8.21).
 * Backfilled and live links are never changed.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated %d lists.
 */
class PaymentHistoryReconciliation {

	/**
	 * Reasons whose transaction an administrator can link: the evidence
	 * named no purchase, or more than one, or didn't add up. Informational
	 * reasons are already attributed; the others name no money to link.
	 */
	const LINKABLE_REASONS = array( 'no_evidence', 'allocation_mismatch', 'ambiguous_activity_charge', 'ambiguous_upgrade', 'participant_relationship_conflict', 'existing_link_conflict' );

	/**
	 * Roles an administrator can give a link. A legacy refund record is
	 * only ever kept from the ledger (§11).
	 */
	const ROLES = array( SignupPaymentLink::ROLE_CHARGE, SignupPaymentLink::ROLE_ADDITIONAL_CHARGE, SignupPaymentLink::ROLE_UPGRADE );

	/**
	 * Longest note kept.
	 */
	const MAX_NOTE_LENGTH = 2000;

	/**
	 * Most candidate purchases suggested for one finding.
	 */
	const MAX_CANDIDATES = 50;

	/**
	 * Link errors that describe the requested allocation, not a failure.
	 */
	const INVALID_LINK_ERRORS = array( 'invalid_payment_link', 'duplicate_payment_link', 'payment_link_conflict', 'allocation_exceeds_total', 'payment_link_unknown_purchase', 'invalid_payment_transaction' );

	/**
	 * Link a finding's transaction to purchases, with each one's allocation.
	 *
	 * @param int   $finding_id        Finding ID.
	 * @param array $links             Each: signup_id, role, allocated_amount.
	 * @param array $args              note (required), expected_link_ids (the transaction's links the
	 *                                 administrator saw), user_id.
	 * @return array|\WP_Error finding, links, audit_id; or why nothing changed.
	 */
	public static function link( $finding_id, array $links, array $args ) {
		$note = self::note( $args );
		if ( is_wp_error( $note ) ) {
			return $note;
		}
		$finding = self::reconcilable_finding( $finding_id );
		if ( is_wp_error( $finding ) ) {
			return $finding;
		}
		$refused = self::link_refusal( $finding );
		if ( $refused ) {
			return self::error( $refused, 400 );
		}
		if ( ! $links ) {
			return self::error( 'reconciliation_links_required', 400 );
		}

		$transaction_id = (int) $finding['source_id'];
		$evidence       = array(
			'type'       => 'reconciliation',
			'finding_id' => (int) $finding['id'],
			'reason'     => (string) $finding['reason'],
			'user_id'    => (int) $args['user_id'],
		);
		$requested      = array();
		foreach ( array_values( $links ) as $link ) {
			$role = (string) ( $link['role'] ?? SignupPaymentLink::ROLE_CHARGE );
			if ( ! in_array( $role, self::ROLES, true ) ) {
				return self::error( 'invalid_payment_link', 400, array( 'field' => 'role' ) );
			}
			$requested[] = array(
				'signup_id'        => (int) ( $link['signup_id'] ?? 0 ),
				'role'             => $role,
				'allocated_amount' => $link['allocated_amount'] ?? null,
				'attribution'      => SignupPaymentLink::ATTRIBUTION_RECONCILED,
				'evidence'         => $evidence,
			);
		}

		return self::locked(
			$transaction_id,
			static function () use ( $finding, $transaction_id, $requested, $note, $args ) {
				$current = PaymentHistoryFinding::get( (int) $finding['id'], true );
				if ( ! $current || PaymentHistoryFinding::STATUS_OPEN !== $current['status'] ) {
					return self::error( 'reconciliation_stale', 409, array( 'status' => $current['status'] ?? null ) );
				}
				$before_links = SignupPaymentLink::get_by_transaction_id( $transaction_id );
				$stale        = self::stale_links( $before_links, $args );
				if ( $stale ) {
					return $stale;
				}

				$written = PaymentLinks::write_in_transaction( $transaction_id, $requested );
				if ( is_wp_error( $written ) ) {
					return self::with_status( $written, in_array( $written->get_error_code(), self::INVALID_LINK_ERRORS, true ) ? 400 : 409 );
				}
				if ( 0 === (int) $written['inserted'] ) {
					return self::error( 'reconciliation_no_change', 400 );
				}

				// Every open finding about attributing this transaction is
				// settled by the same decision.
				$related = array_column(
					PaymentHistoryFinding::query(
						PaymentHistoryFinding::MODE_BACKFILL,
						array(
							'source_type' => PaymentHistoryFinding::SOURCE_TRANSACTION,
							'source_id'   => $transaction_id,
							'status'      => PaymentHistoryFinding::STATUS_OPEN,
							'limit'       => 500,
						)
					),
					'reason',
					'id'
				);
				$settled = array_keys( array_intersect( $related, self::LINKABLE_REASONS ) );
				PaymentHistoryFinding::transition( $settled, PaymentHistoryFinding::STATUS_OPEN, PaymentHistoryFinding::STATUS_RECONCILED );

				$audit_id = PaymentHistoryAudit::append(
					array(
						'action'         => PaymentHistoryAudit::ACTION_LINK,
						'finding_id'     => (int) $finding['id'],
						'reason'         => (string) $finding['reason'],
						'transaction_id' => $transaction_id,
						'user_id'        => (int) $args['user_id'],
						'note'           => $note,
						'before'         => array(
							'finding_status' => PaymentHistoryFinding::STATUS_OPEN,
							'links'          => self::audit_links( $before_links ),
						),
						'after'          => array(
							'finding_status'   => PaymentHistoryFinding::STATUS_RECONCILED,
							'settled_findings' => $settled,
							'links'            => self::audit_links( $written['links'] ),
						),
					)
				);
				if ( ! $audit_id ) {
					return self::error( 'reconciliation_audit_failed', 500 );
				}

				return array(
					'audit_id'   => $audit_id,
					'links'      => $written['links'],
					'signup_ids' => array_column( $requested, 'signup_id' ),
				);
			}
		);
	}

	/**
	 * Remove a link an administrator reconciled. When the transaction has
	 * no reconciled link left, the findings that decision settled are open
	 * again.
	 *
	 * @param int   $link_id Link ID.
	 * @param array $args    note (required), expected_link_ids, user_id.
	 * @return array|\WP_Error links, audit_id; or why nothing changed.
	 */
	public static function unlink( $link_id, array $args ) {
		$note = self::note( $args );
		if ( is_wp_error( $note ) ) {
			return $note;
		}
		if ( ! PaymentHistoryCompatibility::reconciliation_available() ) {
			return self::error( 'reconciliation_unavailable', 503 );
		}
		$link = SignupPaymentLink::get( (int) $link_id );
		if ( ! $link ) {
			return self::error( 'payment_link_not_found', 404 );
		}
		if ( SignupPaymentLink::ATTRIBUTION_RECONCILED !== $link['attribution'] ) {
			return self::error( 'payment_link_not_removable', 400 );
		}

		$transaction_id = (int) $link['transaction_id'];
		$evidence       = json_decode( (string) $link['evidence'], true );
		$finding_id     = (int) ( $evidence['finding_id'] ?? 0 );

		return self::locked(
			$transaction_id,
			static function () use ( $link, $transaction_id, $finding_id, $note, $args ) {
				$before_links = SignupPaymentLink::get_by_transaction_id( $transaction_id );
				$stale        = self::stale_links( $before_links, $args );
				if ( $stale ) {
					return $stale;
				}
				if ( ! SignupPaymentLink::delete_reconciled( (int) $link['id'] ) ) {
					return self::error( 'reconciliation_stale', 409 );
				}

				$after_links = SignupPaymentLink::get_by_transaction_id( $transaction_id );
				$reopened    = array();
				if ( ! in_array( SignupPaymentLink::ATTRIBUTION_RECONCILED, array_column( $after_links, 'attribution' ), true ) ) {
					$reopened = array_column(
						PaymentHistoryFinding::query(
							PaymentHistoryFinding::MODE_BACKFILL,
							array(
								'source_type' => PaymentHistoryFinding::SOURCE_TRANSACTION,
								'source_id'   => $transaction_id,
								'status'      => PaymentHistoryFinding::STATUS_RECONCILED,
								'limit'       => 500,
							)
						),
						'id'
					);
					PaymentHistoryFinding::transition( $reopened, PaymentHistoryFinding::STATUS_RECONCILED, PaymentHistoryFinding::STATUS_OPEN );
				}

				$finding  = $finding_id ? PaymentHistoryFinding::get( $finding_id ) : null;
				$audit_id = PaymentHistoryAudit::append(
					array(
						'action'         => PaymentHistoryAudit::ACTION_UNLINK,
						'finding_id'     => $finding ? (int) $finding['id'] : null,
						'reason'         => $finding ? (string) $finding['reason'] : null,
						'transaction_id' => $transaction_id,
						'user_id'        => (int) $args['user_id'],
						'note'           => $note,
						'before'         => array( 'links' => self::audit_links( $before_links ) ),
						'after'          => array(
							'links'             => self::audit_links( $after_links ),
							'reopened_findings' => array_map( 'intval', $reopened ),
						),
					)
				);
				if ( ! $audit_id ) {
					return self::error( 'reconciliation_audit_failed', 500 );
				}

				return array(
					'audit_id'   => $audit_id,
					'links'      => $after_links,
					'signup_ids' => array( (int) $link['signup_id'] ),
				);
			}
		);
	}

	/**
	 * Mark a finding as reviewed: the administrator keeps the record as it
	 * is, without a link. A re-run doesn't report it again.
	 *
	 * @param int   $finding_id Finding ID.
	 * @param array $args       note (required), user_id.
	 * @return array|\WP_Error finding, audit_id; or why nothing changed.
	 */
	public static function review( $finding_id, array $args ) {
		$note = self::note( $args );
		if ( is_wp_error( $note ) ) {
			return $note;
		}
		$finding = self::reconcilable_finding( $finding_id );
		if ( is_wp_error( $finding ) ) {
			return $finding;
		}

		$apply = static function () use ( $finding, $note, $args ) {
			$current = PaymentHistoryFinding::get( (int) $finding['id'], true );
			if ( ! $current || PaymentHistoryFinding::STATUS_OPEN !== $current['status'] ) {
				return self::error( 'reconciliation_stale', 409, array( 'status' => $current['status'] ?? null ) );
			}
			PaymentHistoryFinding::transition( array( (int) $finding['id'] ), PaymentHistoryFinding::STATUS_OPEN, PaymentHistoryFinding::STATUS_REVIEWED );

			$is_transaction = PaymentHistoryFinding::SOURCE_TRANSACTION === $finding['source_type'];
			$links          = $is_transaction ? self::audit_links( SignupPaymentLink::get_by_transaction_id( (int) $finding['source_id'] ) ) : array();
			$audit_id       = PaymentHistoryAudit::append(
				array(
					'action'         => PaymentHistoryAudit::ACTION_REVIEW,
					'finding_id'     => (int) $finding['id'],
					'reason'         => (string) $finding['reason'],
					'transaction_id' => $is_transaction ? (int) $finding['source_id'] : null,
					'user_id'        => (int) $args['user_id'],
					'note'           => $note,
					'before'         => array(
						'finding_status' => PaymentHistoryFinding::STATUS_OPEN,
						'links'          => $links,
					),
					'after'          => array(
						'finding_status' => PaymentHistoryFinding::STATUS_REVIEWED,
						'links'          => $links,
					),
				)
			);
			if ( ! $audit_id ) {
				return self::error( 'reconciliation_audit_failed', 500 );
			}
			return array(
				'audit_id'   => $audit_id,
				'signup_ids' => array(),
			);
		};

		// A transaction's finding is decided under its writer lock, so it
		// can't race a link being written for it.
		$lock_id = PaymentHistoryFinding::SOURCE_TRANSACTION === $finding['source_type'] ? (int) $finding['source_id'] : 0;
		return self::locked( $lock_id, $apply );
	}

	/**
	 * Everything an administrator needs to decide on one finding: the
	 * transaction with its total, the links it has and what is left of its
	 * total, purchases the record's hints point to, and the audit trail.
	 *
	 * @param int $finding_id Finding ID.
	 * @return array|\WP_Error
	 */
	public static function context( $finding_id ) {
		$finding = PaymentHistoryFinding::get( (int) $finding_id );
		if ( ! $finding ) {
			return self::error( 'finding_not_found', 404 );
		}

		$transaction = null;
		$links       = array();
		$hints       = array(
			'signup_ids'       => array(),
			'relationship_ids' => array(),
			'event_date_ids'   => array_filter( array( (int) $finding['event_date_id'] ) ),
			'participant_id'   => 0,
		);
		$detail      = is_array( $finding['detail'] ) ? $finding['detail'] : array();
		foreach ( (array) ( $detail['proposed'] ?? array() ) as $proposed ) {
			$hints['signup_ids'][] = (int) ( $proposed['signup_id'] ?? 0 );
		}
		if ( PaymentHistoryFinding::SOURCE_SIGNUP === $finding['source_type'] ) {
			$hints['signup_ids'][] = (int) $finding['source_id'];
		}

		$payment_information = PaymentHistoryCompatibility::payment_information_available();
		$transaction_id      = self::transaction_id_of( $finding );
		if ( $transaction_id ) {
			$links = self::describe_links( SignupPaymentLink::get_by_transaction_id( $transaction_id ) );
			foreach ( $links as $link ) {
				$hints['signup_ids'][] = (int) $link['signup_id'];
			}
			if ( $payment_information ) {
				$transaction = self::describe_transaction( $transaction_id, $hints );
			}
		}

		$allocated = 0;
		foreach ( $links as $link ) {
			$allocated += (int) round( LineItemTotals::normalize_amount( $link['allocated_amount'] ) * 100 );
		}

		$link_refusal = self::link_refusal( $finding );
		return array(
			'finding'             => self::describe_finding( $finding ),
			'payment_information' => $payment_information ? 'available' : 'unavailable',
			'transaction'         => $transaction,
			'transaction_id'      => $transaction_id ? $transaction_id : null,
			'links'               => $links,
			'allocated'           => round( $allocated / 100, 2 ),
			'remaining'           => $transaction && ! $transaction['missing'] ? round( max( 0, (int) round( (float) $transaction['amount'] * 100 ) - $allocated ) / 100, 2 ) : null,
			'can_link'            => null === $link_refusal,
			'link_refusal'        => $link_refusal,
			'can_review'          => PaymentHistoryFinding::MODE_BACKFILL === $finding['mode'] && PaymentHistoryFinding::STATUS_OPEN === $finding['status'],
			'candidates'          => self::candidates( $hints ),
			'audit'               => self::describe_audit(
				PaymentHistoryAudit::query(
					array(
						'finding_id'     => (int) $finding['id'],
						'transaction_id' => $transaction_id,
						'limit'          => 50,
					)
				)
			),
		);
	}

	/**
	 * Audit records with the acting user's display name.
	 *
	 * @param array[] $entries Records from PaymentHistoryAudit::query().
	 * @return array[]
	 */
	public static function describe_audit( array $entries ) {
		return array_map(
			static function ( $entry ) {
				$user               = get_userdata( (int) $entry['user_id'] );
				$entry['user_name'] = $user ? (string) $user->display_name : null;
				return $entry;
			},
			$entries
		);
	}

	/**
	 * Purchases matching a search, for linking a transaction by hand.
	 *
	 * @param string $search        Purchase ID, or part of a name or email.
	 * @param int    $event_date_id Only this event date; 0 for any.
	 * @return array[] Purchase summaries.
	 */
	public static function search_purchases( $search, $event_date_id = 0 ) {
		global $wpdb;

		$search = trim( (string) $search );
		$where  = array( '1 = 1' );
		$args   = array( $wpdb->prefix . 'fair_events_signups' );
		if ( $event_date_id > 0 ) {
			$where[] = 'event_date_id = %d';
			$args[]  = (int) $event_date_id;
		}
		if ( '' !== $search ) {
			$like = '%' . $wpdb->esc_like( $search ) . '%';
			if ( ctype_digit( ltrim( $search, '#' ) ) ) {
				$where[] = '( id = %d OR name LIKE %s OR email LIKE %s )';
				$args[]  = (int) ltrim( $search, '#' );
			} else {
				$where[] = '( name LIKE %s OR email LIKE %s )';
			}
			$args[] = $like;
			$args[] = $like;
		}
		$where_sql = implode( ' AND ', $where );

		$ids = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT id FROM %i WHERE {$where_sql} ORDER BY id DESC LIMIT 20", $args ) ) );
		return self::describe_purchases( $ids );
	}

	/**
	 * Why a finding's transaction can't be linked, or null when it can.
	 *
	 * @param array $finding Finding.
	 * @return string|null Refusal code.
	 */
	public static function link_refusal( array $finding ) {
		if ( PaymentHistoryFinding::MODE_BACKFILL !== $finding['mode'] ) {
			return 'finding_not_reconcilable';
		}
		if ( PaymentHistoryFinding::STATUS_OPEN !== $finding['status'] ) {
			return 'finding_decided';
		}
		if ( PaymentHistoryFinding::SOURCE_TRANSACTION !== $finding['source_type'] || ! in_array( $finding['reason'], self::LINKABLE_REASONS, true ) ) {
			return 'finding_not_linkable';
		}
		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			return 'payment_information_unavailable';
		}
		return null;
	}

	/**
	 * The finding, when reconciliation is available and it is a backfill
	 * finding.
	 *
	 * @param int $finding_id Finding ID.
	 * @return array|\WP_Error
	 */
	private static function reconcilable_finding( $finding_id ) {
		if ( ! PaymentHistoryCompatibility::reconciliation_available() ) {
			return self::error( 'reconciliation_unavailable', 503 );
		}
		$finding = PaymentHistoryFinding::get( (int) $finding_id );
		if ( ! $finding ) {
			return self::error( 'finding_not_found', 404 );
		}
		if ( PaymentHistoryFinding::MODE_BACKFILL !== $finding['mode'] ) {
			return self::error( 'finding_not_reconcilable', 400 );
		}
		return $finding;
	}

	/**
	 * Run a change under the transaction's writer lock and in one database
	 * transaction; roll back on an error. Then bring the affected purchases'
	 * amounts up to date.
	 *
	 * @param int      $transaction_id Transaction whose lock to take; 0 for none.
	 * @param callable $change         Returns a result array or a WP_Error.
	 * @return array|\WP_Error
	 */
	private static function locked( $transaction_id, callable $change ) {
		global $wpdb;

		if ( $transaction_id && ! PaymentLinks::acquire_lock( $transaction_id ) ) {
			return self::error( 'payment_links_busy', 409 );
		}

		try {
			$wpdb->query( 'START TRANSACTION' );
			try {
				$result = $change();
			} catch ( \Throwable $error ) {
				$result = self::error( 'reconciliation_failed', 500, array( 'message' => $error->getMessage() ) );
			}
			if ( is_wp_error( $result ) ) {
				$wpdb->query( 'ROLLBACK' );
				return $result;
			}
			$wpdb->query( 'COMMIT' );
		} finally {
			if ( $transaction_id ) {
				PaymentLinks::release_lock( $transaction_id );
			}
		}

		foreach ( array_unique( array_map( 'intval', $result['signup_ids'] ) ) as $signup_id ) {
			ShadowPurchases::refresh_amount( $signup_id );
		}

		unset( $result['signup_ids'] );
		return $result;
	}

	/**
	 * Refuse a change when the transaction's links differ from the ones
	 * the administrator decided on.
	 *
	 * @param array[] $links Current links.
	 * @param array   $args  expected_link_ids.
	 * @return \WP_Error|null
	 */
	private static function stale_links( array $links, array $args ) {
		$expected = array_map( 'intval', (array) ( $args['expected_link_ids'] ?? array() ) );
		$current  = array_map( 'intval', array_column( $links, 'id' ) );
		sort( $expected );
		sort( $current );
		return $expected === $current ? null : self::error( 'reconciliation_stale', 409, array( 'link_ids' => $current ) );
	}

	/**
	 * The required note, trimmed.
	 *
	 * @param array $args note.
	 * @return string|\WP_Error
	 */
	private static function note( array $args ) {
		$note = trim( sanitize_textarea_field( (string) ( $args['note'] ?? '' ) ) );
		if ( '' === $note ) {
			return self::error( 'reconciliation_note_required', 400 );
		}
		return function_exists( 'mb_substr' ) ? mb_substr( $note, 0, self::MAX_NOTE_LENGTH ) : substr( $note, 0, self::MAX_NOTE_LENGTH );
	}

	/**
	 * The transaction a finding is about, if any.
	 *
	 * @param array $finding Finding.
	 * @return int
	 */
	private static function transaction_id_of( array $finding ) {
		if ( PaymentHistoryFinding::SOURCE_TRANSACTION === $finding['source_type'] ) {
			return (int) $finding['source_id'];
		}
		$detail = is_array( $finding['detail'] ) ? $finding['detail'] : array();
		return (int) ( $detail['transaction_id'] ?? 0 );
	}

	/**
	 * A finding for the API, with its event date.
	 *
	 * @param array $finding Finding.
	 * @return array
	 */
	public static function describe_finding( array $finding ) {
		$labels = self::event_date_labels( array( (int) $finding['event_date_id'] ) );
		return array(
			'id'            => (int) $finding['id'],
			'mode'          => (string) $finding['mode'],
			'reason'        => (string) $finding['reason'],
			'informational' => in_array( $finding['reason'], PaymentHistoryFinding::INFORMATIONAL, true ),
			'source_type'   => (string) $finding['source_type'],
			'source_id'     => (int) $finding['source_id'],
			'event_date_id' => $finding['event_date_id'],
			'event_date'    => $labels[ (int) $finding['event_date_id'] ] ?? null,
			'status'        => (string) $finding['status'],
			'detail'        => $finding['detail'],
			'first_seen_at' => (string) $finding['first_seen_at'],
			'last_seen_at'  => (string) $finding['last_seen_at'],
		);
	}

	/**
	 * Title and start of event dates, keyed by ID.
	 *
	 * @param int[] $ids Event date IDs.
	 * @return array<int, array{id: int, title: string, start_date: string|null, start_time: string|null, all_day: bool}>
	 */
	public static function event_date_labels( array $ids ) {
		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids ) {
			return array();
		}
		$labels = array();
		foreach ( EventDates::get_by_ids( $ids ) as $id => $event_date ) {
			$labels[ (int) $id ] = array(
				'id'         => (int) $id,
				'title'      => (string) $event_date->get_display_title(),
				'start_date' => $event_date->start_date,
				'start_time' => $event_date->start_time,
				'all_day'    => (bool) $event_date->all_day,
			);
		}
		return $labels;
	}

	/**
	 * Connector's view of the transaction, with the hints its metadata and
	 * editable columns give. Hints are shown, never used to link (§6.1).
	 *
	 * @param int   $transaction_id Transaction ID.
	 * @param array $hints          Hints, extended in place.
	 * @return array
	 */
	private static function describe_transaction( $transaction_id, array &$hints ) {
		$transaction = PaymentAttributionDatabase::transaction( $transaction_id );
		if ( ! $transaction ) {
			return array(
				'id'      => (int) $transaction_id,
				'missing' => true,
			);
		}

		$row         = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
		$metadata    = $transaction['metadata'];
		$named       = array_values( array_filter( array_map( 'intval', array_merge( (array) ( $metadata['signup_ids'] ?? array() ), array( $metadata['signup_id'] ?? 0 ) ) ) ) );
		$named_rel   = array_values( array_filter( array_map( 'intval', array_merge( (array) ( $metadata['event_participant_ids'] ?? array() ), array( $metadata['event_participant_id'] ?? 0 ) ) ) ) );
		$event_date  = (int) ( $metadata['event_date_id'] ?? 0 );
		$event_date  = $event_date ? $event_date : (int) ( $row->event_date_id ?? 0 );
		$participant = (int) ( $metadata['participant_id'] ?? 0 );
		$participant = $participant ? $participant : (int) ( $row->participant_id ?? 0 );

		$hints['signup_ids']       = array_merge( $hints['signup_ids'], $named );
		$hints['relationship_ids'] = $named_rel;
		$hints['event_date_ids'][] = $event_date;
		$hints['participant_id']   = $participant;

		return array(
			'id'          => (int) $transaction['id'],
			'missing'     => false,
			'amount'      => LineItemTotals::normalize_amount( $transaction['amount'] ),
			'currency'    => strtoupper( $transaction['currency'] ),
			'status'      => $transaction['status'],
			'created_at'  => $transaction['created_at'],
			'source'      => (string) ( $metadata['source'] ?? '' ),
			'description' => (string) ( $row->description ?? '' ),
			'line_items'  => $transaction['line_items'],
			'hints'       => array(
				'event_date_id'         => $event_date ? $event_date : null,
				'participant_id'        => $participant ? $participant : null,
				'signup_ids'            => $named,
				'event_participant_ids' => $named_rel,
				'retry_of'              => isset( $metadata['retry_of_transaction_id'] ) ? (int) $metadata['retry_of_transaction_id'] : null,
			),
		);
	}

	/**
	 * Links with their purchases, for the API.
	 *
	 * @param array[] $links Link rows.
	 * @return array[]
	 */
	private static function describe_links( array $links ) {
		$purchases = array();
		foreach ( self::describe_purchases( array_column( $links, 'signup_id' ) ) as $purchase ) {
			$purchases[ $purchase['id'] ] = $purchase;
		}
		return array_map(
			static function ( $link ) use ( $purchases ) {
				return array(
					'id'               => (int) $link['id'],
					'signup_id'        => (int) $link['signup_id'],
					'transaction_id'   => (int) $link['transaction_id'],
					'role'             => (string) $link['role'],
					'allocated_amount' => LineItemTotals::normalize_amount( $link['allocated_amount'] ),
					'currency'         => (string) $link['currency'],
					'attribution'      => (string) $link['attribution'],
					'removable'        => SignupPaymentLink::ATTRIBUTION_RECONCILED === $link['attribution'],
					'created_at'       => (string) $link['created_at'],
					'purchase'         => $purchases[ (int) $link['signup_id'] ] ?? null,
				);
			},
			$links
		);
	}

	/**
	 * Purchases the hints point to: named ones first, then those migrated
	 * from the registrations the payment names, then those of the hinted
	 * participant and event dates.
	 *
	 * @param array $hints signup_ids, relationship_ids, event_date_ids, participant_id.
	 * @return array[]
	 */
	private static function candidates( array $hints ) {
		global $wpdb;

		$table         = $wpdb->prefix . 'fair_events_signups';
		$ids           = array_values( array_filter( array_map( 'intval', $hints['signup_ids'] ) ) );
		$relationships = array_values( array_filter( array_map( 'intval', $hints['relationship_ids'] ) ) );
		if ( $relationships ) {
			$ids = array_merge(
				$ids,
				array_map(
					'intval',
					(array) $wpdb->get_col(
						$wpdb->prepare(
							'SELECT id FROM %i WHERE legacy_event_participant_id IN ( ' . implode( ', ', array_fill( 0, count( $relationships ), '%d' ) ) . ' ) ORDER BY id ASC',
							array_merge( array( $table ), $relationships )
						)
					)
				)
			);
		}
		$dates = array_values( array_unique( array_filter( array_map( 'intval', $hints['event_date_ids'] ) ) ) );
		if ( $dates ) {
			$ids = array_merge(
				$ids,
				array_map(
					'intval',
					(array) $wpdb->get_col(
						$wpdb->prepare(
							'SELECT id FROM %i WHERE event_date_id IN ( ' . implode( ', ', array_fill( 0, count( $dates ), '%d' ) ) . ' ) ORDER BY ( participant_id = %d ) DESC, id ASC LIMIT %d',
							array_merge( array( $table ), $dates, array( (int) $hints['participant_id'], self::MAX_CANDIDATES ) )
						)
					)
				)
			);
		}
		$ids = array_slice( array_values( array_unique( $ids ) ), 0, self::MAX_CANDIDATES );
		return self::describe_purchases( $ids );
	}

	/**
	 * Purchase summaries in the given order.
	 *
	 * @param int[] $ids Signup IDs.
	 * @return array[]
	 */
	private static function describe_purchases( array $ids ) {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids ) {
			return array();
		}
		$rows = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, event_date_id, name, email, quantity, amount, status, participant_id, legacy_event_participant_id, created_at FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ' )',
				array_merge( array( $wpdb->prefix . 'fair_events_signups' ), $ids )
			),
			ARRAY_A
		) as $row ) {
			$rows[ (int) $row['id'] ] = $row;
		}
		$labels = self::event_date_labels( array_column( $rows, 'event_date_id' ) );

		$purchases = array();
		foreach ( $ids as $id ) {
			if ( ! isset( $rows[ $id ] ) ) {
				continue;
			}
			$row         = $rows[ $id ];
			$purchases[] = array(
				'id'             => $id,
				'name'           => (string) $row['name'],
				'email'          => (string) $row['email'],
				'quantity'       => (int) $row['quantity'],
				'amount'         => LineItemTotals::normalize_amount( $row['amount'] ),
				'status'         => (string) $row['status'],
				'participant_id' => null === $row['participant_id'] ? null : (int) $row['participant_id'],
				'backfilled'     => null !== $row['legacy_event_participant_id'],
				'event_date_id'  => (int) $row['event_date_id'],
				'event_date'     => $labels[ (int) $row['event_date_id'] ] ?? null,
				'created_at'     => (string) $row['created_at'],
			);
		}
		return $purchases;
	}

	/**
	 * Links as kept in the audit: what identifies them and their money.
	 *
	 * @param array[] $links Link rows.
	 * @return array[]
	 */
	private static function audit_links( array $links ) {
		return array_map(
			static function ( $link ) {
				return array(
					'id'               => (int) $link['id'],
					'signup_id'        => (int) $link['signup_id'],
					'role'             => (string) $link['role'],
					'allocated_amount' => LineItemTotals::normalize_amount( $link['allocated_amount'] ),
					'currency'         => (string) $link['currency'],
					'attribution'      => (string) $link['attribution'],
				);
			},
			array_values( $links )
		);
	}

	/**
	 * An error with an HTTP status.
	 *
	 * @param string $code   Code.
	 * @param int    $status HTTP status.
	 * @param array  $data   More data.
	 * @return \WP_Error
	 */
	private static function error( $code, $status, array $data = array() ) {
		return new \WP_Error( $code, self::message( $code ), array( 'status' => $status ) + $data );
	}

	/**
	 * A link writer's error with an HTTP status, keeping its data.
	 *
	 * @param \WP_Error $error  Error.
	 * @param int       $status HTTP status.
	 * @return \WP_Error
	 */
	private static function with_status( \WP_Error $error, $status ) {
		$data = $error->get_error_data();
		return new \WP_Error(
			$error->get_error_code(),
			self::message( $error->get_error_code(), $error->get_error_message() ),
			array( 'status' => $status ) + ( is_array( $data ) ? $data : array() )
		);
	}

	/**
	 * A translated message for an error code.
	 *
	 * @param string $code     Code.
	 * @param string $fallback Message when the code has none here.
	 * @return string
	 */
	private static function message( $code, $fallback = '' ) {
		$messages = array(
			'reconciliation_unavailable'      => __( 'Reconciliation isn\'t available until Fair Events finishes its database update.', 'fair-events' ),
			'finding_not_found'               => __( 'This record no longer exists.', 'fair-events' ),
			'finding_not_reconcilable'        => __( 'Records from a dry run can\'t be reconciled. Start the migration, then reconcile what it reports.', 'fair-events' ),
			'finding_decided'                 => __( 'This record was already reconciled or reviewed.', 'fair-events' ),
			'finding_not_linkable'            => __( 'This record has no payment that could be linked to a purchase. You can mark it as reviewed.', 'fair-events' ),
			'payment_information_unavailable' => __( 'Payment information can\'t be read because Fair Payments Connector is inactive or not installed.', 'fair-events' ),
			'reconciliation_links_required'   => __( 'Choose at least one purchase to link.', 'fair-events' ),
			'reconciliation_note_required'    => __( 'Enter a note explaining the decision.', 'fair-events' ),
			'reconciliation_stale'            => __( 'Someone changed this payment while you were reviewing it. Reload it and decide again.', 'fair-events' ),
			'reconciliation_no_change'        => __( 'These links already exist. Nothing was changed.', 'fair-events' ),
			'reconciliation_audit_failed'     => __( 'The decision couldn\'t be recorded, so nothing was changed. Try again.', 'fair-events' ),
			'reconciliation_failed'           => __( 'The decision couldn\'t be saved, so nothing was changed. Try again.', 'fair-events' ),
			'payment_links_busy'              => __( 'This payment is being updated right now. Try again in a moment.', 'fair-events' ),
			'payment_link_not_found'          => __( 'This link no longer exists.', 'fair-events' ),
			'payment_link_not_removable'      => __( 'Only links added during reconciliation can be removed.', 'fair-events' ),
			'allocation_exceeds_total'        => __( 'The amounts add up to more than the payment\'s total.', 'fair-events' ),
			'payment_link_conflict'           => __( 'One of these purchases is already linked to this payment with a different amount.', 'fair-events' ),
			'duplicate_payment_link'          => __( 'The same purchase is listed twice with the same role.', 'fair-events' ),
			'payment_link_unknown_purchase'   => __( 'One of these purchases no longer exists.', 'fair-events' ),
			'invalid_payment_link'            => __( 'Each linked purchase needs a role and an amount of zero or more.', 'fair-events' ),
			'invalid_payment_transaction'     => __( 'This payment has no valid total or currency, so it can\'t be linked.', 'fair-events' ),
			'missing_transaction'             => __( 'This payment no longer exists in Fair Payments Connector.', 'fair-events' ),
		);
		return $messages[ $code ] ?? ( '' !== $fallback ? $fallback : __( 'The decision couldn\'t be saved.', 'fair-events' ) );
	}
}
