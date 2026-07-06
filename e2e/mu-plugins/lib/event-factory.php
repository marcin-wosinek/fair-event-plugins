<?php
/**
 * E2E event-seeding factory — composable builder steps.
 *
 * Thin wrappers over the real FairEvents models so seed presets
 * (see scripts/seed-event.php) stay a few lines each and new flavours are
 * cheap to add. Loaded via `require_once` from the eval-file seed script; not
 * auto-loaded as a mu-plugin.
 *
 * Test-only code, mounted into the wp-env tests instance via .wp-env.json —
 * never shipped.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketPrice;
use FairEvents\Services\RecurrenceService;
use FairEventsExperimental\Models\TicketOption;

if ( ! function_exists( 'fair_e2e_create_event' ) ) {
	/**
	 * Create a published fair_event post carrying a signup/purchase block.
	 *
	 * @param string $title   Post title (callers pass a timestamped unique title).
	 * @param string $content Post content; defaults to the fair-audience
	 *                        event-signup block. Pass the fair-events get-tickets
	 *                        block for specs that run without fair-audience.
	 * @return int Event post ID.
	 */
	function fair_e2e_create_event( $title, $content = '<!-- wp:fair-audience/event-signup /-->' ) {
		$event_id = wp_insert_post(
			array(
				'post_type'    => 'fair_event',
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_content' => $content,
			),
			true
		);

		if ( is_wp_error( $event_id ) ) {
			WP_CLI::error( 'Failed to create event: ' . $event_id->get_error_message() );
		}

		return (int) $event_id;
	}

	/**
	 * Add a single occurrence (+7 days, two hours long) to an event.
	 *
	 * @param int $event_id Event post ID.
	 * @return int Event date ID.
	 */
	function fair_e2e_add_date( $event_id ) {
		$event_date_id = EventDates::save_occurrence(
			$event_id,
			gmdate( 'Y-m-d H:i:s', strtotime( '+7 days' ) ),
			gmdate( 'Y-m-d H:i:s', strtotime( '+7 days +2 hours' ) ),
			false,
			'single'
		);

		if ( ! $event_date_id ) {
			WP_CLI::error( 'Failed to create event date.' );
		}

		return (int) $event_date_id;
	}

	/**
	 * Turn an event's single occurrence into a weekly recurring series (master +
	 * generated occurrences), all linked to the event post like production
	 * recurring events — as opposed to the standalone event-dates created via
	 * the REST `/event-dates` endpoint, which never carry an `event_id`.
	 *
	 * @param int $event_id Event post ID (must already have one occurrence, see
	 *                      fair_e2e_add_date()).
	 * @param int $count    Number of occurrences in the series (including the master).
	 * @return int[] Occurrence event_date ids, ordered by start_datetime (master first).
	 */
	function fair_e2e_add_series( $event_id, $count = 3 ) {
		$rrule = 'FREQ=WEEKLY;COUNT=' . (int) $count;

		EventDates::save_rrule( $event_id, $rrule );
		RecurrenceService::regenerate_event_occurrences( $event_id, $rrule );

		global $wpdb;
		$table_name = $wpdb->prefix . 'fair_event_dates';
		$ids        = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT id FROM {$table_name} WHERE event_id = %d ORDER BY start_datetime", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$event_id
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Add an active "Standard" sale period (open from yesterday for 30 days).
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int Sale period ID.
	 */
	function fair_e2e_add_sale_period( $event_date_id ) {
		$sale_period_id = TicketSalePeriod::create(
			$event_date_id,
			'Standard',
			gmdate( 'Y-m-d H:i:s', strtotime( '-1 day' ) ),
			gmdate( 'Y-m-d H:i:s', strtotime( '+30 days' ) ),
			0
		);

		if ( ! $sale_period_id ) {
			WP_CLI::error( 'Failed to create sale period.' );
		}

		return (int) $sale_period_id;
	}

	/**
	 * Add a ticket type.
	 *
	 * @param int      $event_date_id Event date ID.
	 * @param string   $name          Ticket type name.
	 * @param int|null $capacity      Capacity (null = unlimited).
	 * @return int Ticket type ID.
	 */
	function fair_e2e_add_ticket_type( $event_date_id, $name, $capacity = null ) {
		$ticket_type_id = TicketType::create( $event_date_id, $name, $capacity, 0 );

		if ( ! $ticket_type_id ) {
			WP_CLI::error( 'Failed to create ticket type.' );
		}

		return (int) $ticket_type_id;
	}

	/**
	 * Add a 'multiple_instances' ticket type (buyer picks N occurrences of the
	 * series, priced per instance) on the series master.
	 *
	 * @param int    $master_event_date_id The series master's event_date_id.
	 * @param string $name                 Ticket type name.
	 * @param int    $minimum_instances    Minimum number of occurrences the buyer must pick.
	 * @return int Ticket type ID.
	 */
	function fair_e2e_add_multi_instance_ticket_type( $master_event_date_id, $name, $minimum_instances = 1 ) {
		$ticket_type_id = TicketType::create(
			$master_event_date_id,
			$name,
			null, // capacity.
			0, // sort_order.
			1, // seats_per_ticket.
			false, // invitation_only.
			0, // minimum_activities.
			null, // disable_at.
			'multiple_instances',
			false, // disabled.
			$minimum_instances
		);

		if ( ! $ticket_type_id ) {
			WP_CLI::error( 'Failed to create multiple_instances ticket type.' );
		}

		return (int) $ticket_type_id;
	}

	/**
	 * Attach a price to a ticket type for a sale period. Its presence is what
	 * makes a ticket type "paid" (a type with no price row is free).
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int      $sale_period_id Sale period ID.
	 * @param float    $price          Price.
	 * @param int|null $capacity       Per-period capacity (null = unlimited).
	 * @return void
	 */
	function fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, $capacity = null ) {
		if ( ! TicketPrice::create( $ticket_type_id, $sale_period_id, $price, $capacity ) ) {
			WP_CLI::error( 'Failed to create ticket price.' );
		}
	}

	/**
	 * Add a ticket option (activity-style add-on) carrying a short_name.
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $name          Option name.
	 * @param float  $price         Option price.
	 * @param string $short_name    Short name.
	 * @param int    $sort_order    Sort order.
	 * @return int Option ID.
	 */
	function fair_e2e_add_option( $event_date_id, $name, $price, $short_name, $sort_order = 0 ) {
		$option_id = TicketOption::create( $event_date_id, $name, $price, $sort_order, $short_name );

		if ( ! $option_id ) {
			WP_CLI::error( 'Failed to create ticket option.' );
		}

		return (int) $option_id;
	}
}
