<?php
/**
 * Event Statistics REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use DateInterval;
use DateTimeImmutable;
use FairAudience\Database\EventParticipantRepository;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Provides display-ready sales statistics for one event occurrence.
 */
class EventStatisticsController extends WP_REST_Controller {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST base.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-dates/(?P<event_date_id>\d+)/statistics';

	/**
	 * Event participant repository.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repo;

	/** Constructor. */
	public function __construct() {
		$this->event_participant_repo = new EventParticipantRepository();
	}

	/** Register the route. */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
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
				),
			)
		);
	}

	/**
	 * Check administrative access.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_forbidden', __( 'You must be logged in.', 'fair-audience' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You do not have permission to view event statistics.', 'fair-audience' ), array( 'status' => 403 ) );
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
		$event_date    = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error( 'event_date_not_found', __( 'Event date not found.', 'fair-audience' ), array( 'status' => 404 ) );
		}

		$timezone = wp_timezone();
		$start    = DateTimeImmutable::createFromFormat( '!Y-m-d', substr( (string) $event_date->start_datetime, 0, 10 ), $timezone );
		if ( ! $start ) {
			return new WP_Error( 'invalid_event_date', __( 'The event start date is invalid.', 'fair-audience' ), array( 'status' => 500 ) );
		}

		$end = DateTimeImmutable::createFromFormat( '!Y-m-d', substr( (string) $event_date->end_datetime, 0, 10 ), $timezone );
		if ( ! $end || $end < $start ) {
			$end = $start;
		}

		$rows        = $this->get_qualifying_sales_rows( $event_date );
		$daily_sales = array();
		foreach ( $rows as $row ) {
			$date = DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $row['created_at'], $timezone );
			if ( $date ) {
				$key                 = $date->format( 'Y-m-d' );
				$daily_sales[ $key ] = ( $daily_sales[ $key ] ?? 0 ) + 1;
			}
		}

		$window_start = $start->sub( new DateInterval( 'P27D' ) );
		$cumulative   = 0;
		foreach ( $daily_sales as $date => $count ) {
			if ( $date < $window_start->format( 'Y-m-d' ) ) {
				$cumulative += $count;
			}
		}

		$series = array();
		$cursor = $window_start;
		while ( $cursor <= $end ) {
			$key = $cursor->format( 'Y-m-d' );
			if ( $cursor < $end ) {
				$cumulative += $daily_sales[ $key ] ?? 0;
			} else {
				// Fold all remaining confirmations into the final event-day point.
				$cumulative = count( $rows );
			}
			$series[] = array(
				'date'  => $key,
				'label' => $this->get_point_label( $cursor, $start, $end ),
				'total' => $cumulative,
			);
			$cursor   = $cursor->add( new DateInterval( 'P1D' ) );
		}

		$today = new DateTimeImmutable( 'today', $timezone );
		return new WP_REST_Response(
			array(
				'total_sales'      => count( $rows ),
				'start_date'       => $start->format( 'Y-m-d' ),
				'end_date'         => $end->format( 'Y-m-d' ),
				'days_until_start' => $today < $start ? (int) $today->diff( $start )->format( '%a' ) : null,
				'series'           => $series,
			)
		);
	}

	/**
	 * Get direct signups plus qualifying whole-series passes.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return array[] Confirmed sale rows.
	 */
	private function get_qualifying_sales_rows( $event_date ) {
		$rows = $this->event_participant_repo->get_confirmed_sales_rows( (int) $event_date->id );
		if ( 'generated' !== $event_date->occurrence_type || ! $event_date->master_id || ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return $rows;
		}

		$participant_ids = array_fill_keys( array_map( 'intval', wp_list_pluck( $rows, 'participant_id' ) ), true );
		$occurrence_time = strtotime( $event_date->start_datetime );
		foreach ( $this->event_participant_repo->get_confirmed_sales_rows( (int) $event_date->master_id ) as $row ) {
			$participant_id = (int) $row['participant_id'];
			if ( isset( $participant_ids[ $participant_id ] ) || empty( $row['ticket_type_id'] ) ) {
				continue;
			}
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( (int) $row['ticket_type_id'] );
			if ( ! $ticket_type || ! $ticket_type->is_whole_series() || ( $row['created_at'] && $occurrence_time < strtotime( $row['created_at'] ) ) ) {
				continue;
			}
			$participant_ids[ $participant_id ] = true;
			$rows[]                             = $row;
		}
		return $rows;
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
				_n( '%d day before the event', '%d days before the event', $days, 'fair-audience' ),
				$days
			);
		}
		if ( $start->format( 'Y-m-d' ) === $end->format( 'Y-m-d' ) ) {
			return __( 'Day of the event', 'fair-audience' );
		}
		$day = (int) $start->diff( $date )->format( '%a' ) + 1;
		return sprintf(
			/* translators: %s: ordinal event-day number, for example 1st or 2nd. */
			__( '%s day of the event', 'fair-audience' ),
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
