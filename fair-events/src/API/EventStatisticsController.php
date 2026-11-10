<?php
/**
 * Event Statistics REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use DateInterval;
use DateTimeImmutable;
use FairEvents\Models\EventDates;
use FairEvents\Services\EventCapacityStatistics;
use FairEvents\Services\EventTicketStatistics;
use FairEvents\Services\PurchasePaymentHistory;
use FairEventsShared\Money;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Provides display-ready sales statistics for one event occurrence: confirmed
 * ticket counts and activity aggregates (see EventTicketStatistics), revenue,
 * and the places currently taken against each capacity limit (see
 * EventCapacityStatistics).
 *
 * Revenue is the paid allocations of the date's purchases
 * (PurchasePaymentHistory, PAYMENT_HISTORY_MIGRATION.md §8.14), so Fair
 * Audience isn't needed. `revenue_state` says whether it is `available`,
 * `incomplete` or `unavailable`; an unavailable amount is null, never 0.
 *
 * Serves the canonical fair-events/v1 route and, for existing consumers, the
 * fair-audience/v1 path the endpoint had before it moved here.
 */
class EventStatisticsController extends WP_REST_Controller {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Former namespace, kept as a compatibility alias.
	 *
	 * @var string
	 */
	protected $legacy_namespace = 'fair-audience/v1';

	/**
	 * REST base.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-dates/(?P<event_date_id>\d+)/statistics';

	/**
	 * Days before the event start that the cumulative series can begin.
	 *
	 * @var int[]
	 */
	const HISTORY_DAYS = array( 30, 60, 90, 180 );

	/**
	 * Default history length when a request names none.
	 *
	 * @var int
	 */
	const DEFAULT_HISTORY_DAYS = 30;

	/**
	 * Register the canonical route and its compatibility alias.
	 *
	 * The alias overrides any handler an older Fair Audience still registers
	 * on the same path, so mixed plugin versions answer from one
	 * implementation.
	 */
	public function register_routes() {
		$route = array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => array( $this, 'get_item' ),
			'permission_callback' => array( $this, 'get_item_permissions_check' ),
			'args'                => array(
				'event_date_id' => array(
					'type'              => 'integer',
					'required'          => true,
					'sanitize_callback' => 'absint',
					'validate_callback' => static fn( $value ) => (int) $value > 0,
				),
				'history_days'  => array(
					'type'              => 'integer',
					'enum'              => self::HISTORY_DAYS,
					'default'           => self::DEFAULT_HISTORY_DAYS,
					'sanitize_callback' => 'absint',
					// Explicit: hand-written args do not enforce enum on their own.
					'validate_callback' => 'rest_validate_request_arg',
				),
			),
		);

		register_rest_route( $this->namespace, '/' . $this->rest_base, $route );
		register_rest_route( $this->legacy_namespace, '/' . $this->rest_base, $route, true );
	}

	/**
	 * Check administrative access.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_forbidden', __( 'You must be logged in.', 'fair-events' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You do not have permission to view event statistics.', 'fair-events' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Return the event statistics.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		$event_date    = EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error( 'event_date_not_found', __( 'Event date not found.', 'fair-events' ), array( 'status' => 404 ) );
		}

		$timezone = wp_timezone();
		$start    = DateTimeImmutable::createFromFormat( '!Y-m-d', (string) $event_date->start_date, $timezone );
		if ( ! $start ) {
			return new WP_Error( 'invalid_event_date', __( 'The event start date is invalid.', 'fair-events' ), array( 'status' => 500 ) );
		}

		$end = DateTimeImmutable::createFromFormat( '!Y-m-d', (string) $event_date->end_date, $timezone );
		if ( ! $end || $end < $start ) {
			$end = $start;
		}
		$today        = new DateTimeImmutable( 'today', $timezone );
		$recorded_end = $today < $end ? $today : $end;

		$currency            = Money::site_currency();
		$revenue             = PurchasePaymentHistory::event_date_revenue( $event_date );
		$available           = PurchasePaymentHistory::STATE_UNAVAILABLE !== $revenue['state'];
		$daily_amounts       = $revenue['daily'];
		$excluded_currencies = $revenue['excluded_currencies'];
		$total_sales_amount  = $available ? (float) $revenue['total'] : null;
		$tickets             = EventTicketStatistics::for_event_date( $event_date );
		$daily_sales         = $tickets['daily'];

		$history_days = (int) $request->get_param( 'history_days' );
		$window_start = $start->sub( new DateInterval( 'P' . $history_days . 'D' ) );
		if ( $window_start > $recorded_end ) {
			$window_start = $recorded_end;
		}
		$cumulative        = 0;
		$cumulative_amount = $available ? 0.0 : null;
		foreach ( $daily_sales as $date => $count ) {
			if ( $date < $window_start->format( 'Y-m-d' ) ) {
				$cumulative += $count;
			}
		}
		foreach ( $daily_amounts as $date => $amount ) {
			if ( $date < $window_start->format( 'Y-m-d' ) ) {
				$cumulative_amount += $amount;
			}
		}

		$series        = array();
		$amount_series = array();
		$cursor        = $window_start;
		while ( $cursor <= $end ) {
			$key = $cursor->format( 'Y-m-d' );
			if ( $cursor < $recorded_end ) {
				$cumulative += $daily_sales[ $key ] ?? 0;
				if ( $available ) {
					$cumulative_amount += $daily_amounts[ $key ] ?? 0.0;
				}
			} elseif ( $key === $recorded_end->format( 'Y-m-d' ) ) {
				// Fold all remaining confirmations into the final visible point.
				$cumulative        = $tickets['total'];
				$cumulative_amount = $total_sales_amount;
			}
			$label           = $this->get_point_label( $cursor, $start, $end );
			$series[]        = array(
				'date'  => $key,
				'label' => $label,
				'total' => $cursor <= $recorded_end ? $cumulative : null,
			);
			$amount_series[] = array(
				'date'   => $key,
				'label'  => $label,
				'amount' => $cursor <= $recorded_end ? $cumulative_amount : null,
			);
			$cursor          = $cursor->add( new DateInterval( 'P1D' ) );
		}

		return new WP_REST_Response(
			array(
				'event_name'                  => trim( (string) $event_date->get_display_title() ),
				'total_tickets'               => $tickets['total'],
				// Deprecated alias of total_tickets, kept for older clients.
				'total_sales'                 => $tickets['total'],
				'currency'                    => $currency,
				'total_sales_amount'          => $total_sales_amount,
				'revenue_state'               => $revenue['state'],
				// Paid money for the date not yet allocated to its purchases.
				'unresolved_payments'         => (int) $revenue['unresolved'],
				'reconciliation_url'          => 'incomplete' === $revenue['state'] ? admin_url( 'admin.php?page=fair-events-payment-history' ) : null,
				// Whole-series pass revenue covering a generated occurrence,
				// counted on its master and never in this total (§7.2).
				'series_pass_revenue'         => $available ? $revenue['series_pass_revenue'] : null,
				'amount_series'               => $amount_series,
				'excluded_currencies'         => $excluded_currencies,
				'start_date'                  => $start->format( 'Y-m-d' ),
				'end_date'                    => $end->format( 'Y-m-d' ),
				'history_days'                => $history_days,
				'days_until_start'            => $today < $start ? (int) $today->diff( $start )->format( '%a' ) : null,
				'series'                      => $series,
				'tickets_per_activity'        => $tickets['tickets_per_activity'],
				'activities_per_ticket'       => $tickets['activities_per_ticket'],
				'incomplete_ticket_backfills' => $tickets['incomplete_ticket_backfills'],
				// Places taken now, payment holds included: not the confirmed
				// sales counted above.
			) + EventCapacityStatistics::for_event_date( $event_date )
		);
	}

	/**
	 * Create a translated relative label for a chart point.
	 *
	 * @param DateTimeImmutable $date  Point date.
	 * @param DateTimeImmutable $start Event start date.
	 * @param DateTimeImmutable $end   Effective event end date.
	 * @return string Translated label.
	 */
	private function get_point_label( $date, $start, $end ) {
		if ( $date < $start ) {
			$days = (int) $date->diff( $start )->format( '%a' );
			return sprintf(
				/* translators: %d: number of calendar days before the event. */
				_n( '%d day before the event', '%d days before the event', $days, 'fair-events' ),
				$days
			);
		}
		if ( $start->format( 'Y-m-d' ) === $end->format( 'Y-m-d' ) ) {
			return __( 'Day of the event', 'fair-events' );
		}
		$day = (int) $start->diff( $date )->format( '%a' ) + 1;
		return sprintf(
			/* translators: %s: ordinal event-day number, for example 1st or 2nd. */
			__( '%s day of the event', 'fair-events' ),
			$this->ordinal( $day )
		);
	}

	/**
	 * Format an ordinal number.
	 *
	 * @param int $number Number to format.
	 * @return string Ordinal number.
	 */
	private function ordinal( $number ) {
		$mod100 = $number % 100;
		if ( $mod100 >= 11 && $mod100 <= 13 ) {
			return $number . 'th';
		}
		return $number . ( array(
			1 => 'st',
			2 => 'nd',
			3 => 'rd',
		)[ $number % 10 ] ?? 'th' );
	}
}
