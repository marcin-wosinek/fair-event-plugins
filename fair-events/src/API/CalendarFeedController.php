<?php
/**
 * REST API Controller for the public ICS calendar feed
 *
 * Read-only mirror of the public JSON events feed (PublicEventsController),
 * serialized as iCalendar for subscribing in Google Calendar, Outlook, etc.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Helpers\DateHelper;
use FairEvents\Services\EventFeedProvider;
use Sabre\VObject\Component\VCalendar;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;

/**
 * Handles the public ICS calendar feed endpoint
 */
class CalendarFeedController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Hard cap on the number of events serialized into a single feed, as a
	 * DoS guard alongside the bounded date range.
	 *
	 * @var int
	 */
	const MAX_EVENTS = 1000;

	/**
	 * Register the routes for the calendar feed
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/calendar.ics - Public ICS calendar feed.
		register_rest_route(
			$this->namespace,
			'/calendar\.ics',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_calendar' ),
					// Genuinely public read-only feed — a subscribe URL for
					// calendar clients, mirroring the already-public
					// /events endpoint.
					'permission_callback' => '__return_true',
					'args'                => array(
						'start_date' => array(
							'description' => __( 'Filter events starting on or after this date (Y-m-d format).', 'fair-events' ),
							'type'        => 'string',
							'format'      => 'date',
						),
						'end_date'   => array(
							'description' => __( 'Filter events ending on or before this date (Y-m-d format).', 'fair-events' ),
							'type'        => 'string',
							'format'      => 'date',
						),
						'categories' => array(
							'description' => __( 'Filter by category slugs (comma-separated).', 'fair-events' ),
							'type'        => 'string',
						),
					),
				),
			)
		);
	}

	/**
	 * Serve the ICS calendar feed
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return void Sends headers and echoes the ICS body directly.
	 */
	public function get_calendar( $request ) {
		$start_date = $request->get_param( 'start_date' );
		$end_date   = $request->get_param( 'end_date' );
		$categories = $request->get_param( 'categories' );

		$provider    = new EventFeedProvider();
		$occurrences = $provider->get_occurrences(
			$this->range_start( $start_date ),
			$this->range_end( $end_date ),
			array( 'categories' => $this->resolve_category_ids( $categories ) )
		);

		$occurrences = array_slice( $occurrences, 0, self::MAX_EVENTS );

		$vcalendar = $this->build_vcalendar( $occurrences );

		header( 'Content-Type: text/calendar; charset=utf-8' );
		header( 'Content-Disposition: inline; filename="calendar.ics"' );
		echo $vcalendar->serialize(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- ICS body, not HTML.
		exit;
	}

	/**
	 * Build the VCALENDAR component for a set of occurrences.
	 *
	 * @param array[] $occurrences Occurrence DTOs from EventFeedProvider.
	 * @return VCalendar
	 */
	private function build_vcalendar( array $occurrences ) {
		$vcalendar                    = new VCalendar();
		$vcalendar->{'X-WR-CALNAME'}  = get_bloginfo( 'name' );
		$vcalendar->{'X-WR-TIMEZONE'} = wp_timezone_string();

		foreach ( $occurrences as $occurrence ) {
			if ( empty( $occurrence['start'] ) ) {
				continue;
			}

			$this->add_vevent( $vcalendar, $occurrence );
		}

		return $vcalendar;
	}

	/**
	 * Add a single VEVENT to the calendar for an occurrence DTO.
	 *
	 * @param VCalendar $vcalendar  Calendar to add the event to.
	 * @param array     $occurrence Occurrence DTO.
	 * @return void
	 */
	private function add_vevent( VCalendar $vcalendar, array $occurrence ) {
		$now = new \DateTime( 'now', new \DateTimeZone( 'UTC' ) );

		$vevent = $vcalendar->add(
			'VEVENT',
			array(
				'UID'           => $occurrence['uid'],
				'SUMMARY'       => $occurrence['title'],
				'DESCRIPTION'   => $occurrence['description'],
				'DTSTAMP'       => $now,
				'LAST-MODIFIED' => $now,
			)
		);

		if ( ! empty( $occurrence['url'] ) ) {
			$vevent->add( 'URL', $occurrence['url'] );
		}

		if ( $occurrence['all_day'] ) {
			$start_date = DateHelper::local_date( $occurrence['start'] );
			$end_date   = DateHelper::next_date( DateHelper::local_date( $occurrence['end'] ) );

			$vevent->add( 'DTSTART', $start_date, array( 'VALUE' => 'DATE' ) );
			$vevent->add( 'DTEND', $end_date, array( 'VALUE' => 'DATE' ) );
		} else {
			$vevent->add( 'DTSTART', DateHelper::local_to_ical_utc( $occurrence['start'] ) );
			$vevent->add( 'DTEND', DateHelper::local_to_ical_utc( $occurrence['end'] ) );
		}
	}

	/**
	 * Convert an optional Y-m-d start_date param into a naive site-local
	 * range-start datetime, bounded to one month before now when omitted.
	 *
	 * @param string|null $start_date Y-m-d date, or null/empty for the bounded default.
	 * @return string Naive 'Y-m-d H:i:s' site-local datetime.
	 */
	private function range_start( $start_date ) {
		if ( $start_date ) {
			return $start_date . ' 00:00:00';
		}

		return wp_date( 'Y-m-d 00:00:00', strtotime( '-1 month', time() ) );
	}

	/**
	 * Convert an optional Y-m-d end_date param into a naive site-local
	 * range-end datetime, bounded to twelve months after now when omitted.
	 *
	 * @param string|null $end_date Y-m-d date, or null/empty for the bounded default.
	 * @return string Naive 'Y-m-d H:i:s' site-local datetime.
	 */
	private function range_end( $end_date ) {
		if ( $end_date ) {
			return $end_date . ' 23:59:59';
		}

		return wp_date( 'Y-m-d 23:59:59', strtotime( '+12 months', time() ) );
	}

	/**
	 * Resolve a comma-separated list of category slugs into term IDs.
	 *
	 * @param string|null $categories Comma-separated category slugs.
	 * @return int[] Category term IDs.
	 */
	private function resolve_category_ids( $categories ) {
		$category_ids = array();

		if ( empty( $categories ) ) {
			return $category_ids;
		}

		$category_slugs = array_map( 'trim', explode( ',', $categories ) );
		foreach ( $category_slugs as $slug ) {
			$term = get_term_by( 'slug', $slug, 'category' );
			if ( $term ) {
				$category_ids[] = $term->term_id;
			}
		}

		return $category_ids;
	}
}
