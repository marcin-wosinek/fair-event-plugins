<?php
/**
 * Signup Payment State Resolver
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Resolves a get-tickets transaction into the richer return-from-payment
 * state (confirmed / processing / resume / retry) the unified Event Signup
 * form needs, instead of the flat confirmed/processing/failed banner
 * PaymentStatus::from_raw_status() collapses everything unfinished into.
 *
 * Single source of truth shared by the callback render path, the
 * direct-navigation (cookie) fallback, and the payment-state REST route —
 * all three build a transaction + its signup row(s) and hand them here.
 */
class SignupPaymentState {

	/**
	 * Transaction paid.
	 */
	const CONFIRMED = 'confirmed';

	/**
	 * A real payment attempt is in flight (Mollie's own 'pending' status) —
	 * distinct from 'pending_payment', which just means a checkout link was
	 * created and nothing is known about the buyer's progress yet.
	 */
	const PROCESSING = 'processing';

	/**
	 * An existing checkout link is still valid; the buyer can pick up where
	 * they left off instead of starting a new attempt.
	 */
	const RESUME = 'resume';

	/**
	 * Terminal failure, or an unfinished attempt with no valid checkout link
	 * to resume — a new payment attempt is needed.
	 */
	const RETRY = 'retry';

	/**
	 * Pure state resolution from a raw transaction status + checkout URL,
	 * split out for unit testing without a database.
	 *
	 * @param string $status       Raw fair-payments-connector transaction status.
	 * @param string $checkout_url Transaction's checkout_url, or ''.
	 * @return string One of self::CONFIRMED, self::PROCESSING, self::RESUME, self::RETRY.
	 */
	public static function resolve_state( string $status, string $checkout_url ): string {
		if ( 'paid' === $status ) {
			return self::CONFIRMED;
		}

		if ( 'pending' === $status ) {
			return self::PROCESSING;
		}

		// Terminal failure always retries, even with a stale checkout_url
		// still on file — Mollie invalidates it once the payment is done.
		if ( in_array( $status, array( 'failed', 'canceled', 'expired' ), true ) ) {
			return self::RETRY;
		}

		return '' !== $checkout_url ? self::RESUME : self::RETRY;
	}

	/**
	 * Resolve the full card payload for a transaction: syncs with the payment
	 * provider first (the callback / in-progress paths this is used from both
	 * need a reconciled status, per the ticket's no-false-paid/unpaid
	 * requirement), then builds the state + amount/currency/checkout_url/event
	 * payload the render and payment-state route both need.
	 *
	 * @param object   $transaction  Transaction object (from TransactionAPI::get_transaction()).
	 * @param object[] $signup_rows  This transaction's fair_events_signups rows (see EventSignup::get_all_by_transaction_id()).
	 * @param bool     $sync         Whether to reconcile with the provider before reading. Callers on a page-load
	 *                               path with no reason to expect a status change (e.g. an already-confirmed poll
	 *                               tick) should pass false to skip the provider round-trip.
	 * @return array{state: string, transaction_id: int, amount: float, currency: string, checkout_url: string, event_date_id: int, event_title: string, tickets: array}
	 */
	public static function resolve_for_transaction( $transaction, array $signup_rows, bool $sync = true ): array {
		if ( $sync
			&& $transaction
			&& ! empty( $transaction->id )
			&& ! empty( $transaction->mollie_payment_id )
			&& function_exists( 'fair_payment_sync_transaction_status' )
		) {
			$synced = fair_payment_sync_transaction_status( (int) $transaction->id );
			if ( $synced && ! is_wp_error( $synced ) ) {
				$transaction = $synced;
			}
		}

		$status       = (string) ( $transaction->status ?? '' );
		$checkout_url = (string) ( $transaction->checkout_url ?? '' );
		$state        = self::resolve_state( $status, $checkout_url );

		$first_row     = $signup_rows[0] ?? null;
		$event_date_id = $first_row ? (int) $first_row->event_date_id : 0;

		return array(
			'state'          => $state,
			'transaction_id' => (int) ( $transaction->id ?? 0 ),
			'amount'         => (float) ( $transaction->amount ?? 0 ),
			'currency'       => (string) ( $transaction->currency ?? '' ),
			'checkout_url'   => self::RESUME === $state ? $checkout_url : '',
			'event_date_id'  => $event_date_id,
			'event_title'    => self::resolve_event_title( $event_date_id ),
			'tickets'        => self::purchase_tickets( $signup_rows ),
		);
	}

	/**
	 * Describe what one purchase bought: a ticket type name and activity
	 * names for each of its tickets, read from the purchase's own signup
	 * rows and ticket units. The buyer may hold other tickets for the same
	 * date; those belong to other purchases and are never listed here.
	 *
	 * @param object[] $signup_rows The purchase's fair_events_signups rows.
	 * @return array<int, array{ticket_type: string, activities: string[]}> One entry per ticket.
	 */
	public static function purchase_tickets( array $signup_rows ): array {
		$tickets = array();

		foreach ( $signup_rows as $signup ) {
			$units = class_exists( \FairEvents\Models\EventTicket::class )
				? \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup->id )
				: array();

			// A signup from before ticket units: its own type, once per place.
			if ( ! $units ) {
				$type_name = self::ticket_type_name( (int) ( $signup->ticket_type_id ?? 0 ) );
				$places    = max( 1, (int) ( $signup->quantity ?? 1 ) );
				for ( $position = 0; $position < $places; $position++ ) {
					$tickets[] = array(
						'ticket_type' => $type_name,
						'activities'  => array(),
					);
				}
				continue;
			}

			$activity_rows = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( wp_list_pluck( $units, 'id' ) );
			foreach ( $units as $unit ) {
				if ( ! empty( $unit->deleted_at ) ) {
					continue;
				}
				$unit_type_id = (int) ( $unit->ticket_type_id ?? 0 );
				$activities   = array();
				foreach ( $activity_rows[ (int) $unit->id ] ?? array() as $row ) {
					$activities[] = self::ticket_option_name( $row );
				}
				$tickets[] = array(
					'ticket_type' => self::ticket_type_name( $unit_type_id ? $unit_type_id : (int) ( $signup->ticket_type_id ?? 0 ) ),
					'activities'  => array_values( array_filter( $activities ) ),
				);
			}
		}

		return $tickets;
	}

	/**
	 * Name of a ticket type, or '' when the purchase has none.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return string
	 */
	private static function ticket_type_name( int $ticket_type_id ): string {
		if ( ! $ticket_type_id || ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return '';
		}

		$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );

		return $ticket_type ? (string) $ticket_type->name : '';
	}

	/**
	 * Name of a ticket's activity: the option's current name, so a rename
	 * shows, else the name stored with the selection.
	 *
	 * @param object $row fair_events_ticket_activities row.
	 * @return string
	 */
	private static function ticket_option_name( $row ): string {
		$option = class_exists( \FairEvents\Models\TicketOption::class )
			? \FairEvents\Models\TicketOption::get_by_id( (int) $row->ticket_option_id )
			: null;

		return $option && '' !== (string) $option->name ? (string) $option->name : (string) ( $row->ticket_option_name ?? '' );
	}

	/**
	 * Resolve the event title for the confirmed/processing card copy.
	 *
	 * @param int $event_date_id Event-date ID the signup row(s) target.
	 * @return string Event title, or '' when not resolvable.
	 */
	private static function resolve_event_title( int $event_date_id ): string {
		if ( ! $event_date_id || ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return '';
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date || empty( $event_date->event_id ) ) {
			return '';
		}

		return (string) get_the_title( (int) $event_date->event_id );
	}
}
