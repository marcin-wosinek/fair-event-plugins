<?php
/**
 * REST API Controller for Tickets
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Models\EventDateSetting;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketPrice;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles tickets REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for tickets
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/tickets',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_items' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for ticket operations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function items_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Get full ticket config for an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_items( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$event_date    = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->build_response( $event_date_id, $event_date ), 200 );
	}

	/**
	 * Bulk save entire ticket config
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function update_items( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$event_date    = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$body = $request->get_json_params();

		// 1. Update capacity on event_dates row.
		if ( array_key_exists( 'capacity', $body ) ) {
			$capacity = null !== $body['capacity'] ? absint( $body['capacity'] ) : null;
			EventDates::update_by_id( $event_date_id, array( 'capacity' => $capacity ) );
		}

		// 2. Diff ticket types.
		$incoming_types = $body['ticket_types'] ?? array();
		$this->sync_ticket_types( $event_date_id, $incoming_types );

		// 3. Diff sale periods.
		$incoming_periods = $body['sale_periods'] ?? array();
		$this->sync_sale_periods( $event_date_id, $incoming_periods );

		// 4. Delete all prices for this event and re-insert.
		TicketPrice::delete_by_event_date_id( $event_date_id );

		$incoming_prices = $body['prices'] ?? array();
		foreach ( $incoming_prices as $price_data ) {
			$type_id   = isset( $price_data['ticket_type_id'] ) ? (int) $price_data['ticket_type_id'] : 0;
			$period_id = isset( $price_data['sale_period_id'] ) ? (int) $price_data['sale_period_id'] : 0;
			$price     = isset( $price_data['price'] ) ? (float) $price_data['price'] : 0;
			$cap       = isset( $price_data['capacity'] ) && null !== $price_data['capacity']
				? absint( $price_data['capacity'] )
				: null;

			if ( $type_id && $period_id ) {
				TicketPrice::create( $type_id, $period_id, $price, $cap );
			}
		}

		// 5. Save settings.
		if ( isset( $body['settings'] ) && is_array( $body['settings'] ) ) {
			$settings = array();
			foreach ( $body['settings'] as $key => $value ) {
				$settings[ sanitize_key( $key ) ] = $value ? '1' : '0';
			}
			EventDateSetting::set_multiple( $event_date_id, $settings );
		}

		// 6. Return refreshed response.
		$event_date = EventDates::get_by_id( $event_date_id );

		return new WP_REST_Response( $this->build_response( $event_date_id, $event_date ), 200 );
	}

	/**
	 * Sync ticket types: delete removed, update existing, insert new
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $incoming      Incoming ticket types from request.
	 * @return void
	 */
	private function sync_ticket_types( $event_date_id, $incoming ) {
		$existing     = TicketType::get_all_by_event_date_id( $event_date_id );
		$existing_ids = array_map( fn( $t ) => $t->id, $existing );
		$incoming_ids = array();

		foreach ( $incoming as $index => $item ) {
			if ( ! empty( $item['id'] ) ) {
				$incoming_ids[] = (int) $item['id'];
			}
		}

		// Delete removed.
		foreach ( $existing_ids as $eid ) {
			if ( ! in_array( $eid, $incoming_ids, true ) ) {
				TicketPrice::delete_by_ticket_type_id( $eid );
				TicketType::delete( $eid );
			}
		}

		// Update existing / insert new.
		foreach ( $incoming as $index => $item ) {
			$name       = sanitize_text_field( $item['name'] ?? '' );
			$capacity   = isset( $item['capacity'] ) && '' !== $item['capacity'] && null !== $item['capacity']
				? absint( $item['capacity'] )
				: null;
			$sort_order = $index;

			if ( ! empty( $item['id'] ) && in_array( (int) $item['id'], $existing_ids, true ) ) {
				TicketType::update(
					(int) $item['id'],
					array(
						'name'       => $name,
						'capacity'   => $capacity,
						'sort_order' => $sort_order,
					)
				);
			} else {
				TicketType::create( $event_date_id, $name, $capacity, $sort_order );
			}
		}
	}

	/**
	 * Sync sale periods: delete removed, update existing, insert new
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $incoming      Incoming sale periods from request.
	 * @return void
	 */
	private function sync_sale_periods( $event_date_id, $incoming ) {
		$existing     = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		$existing_ids = array_map( fn( $p ) => $p->id, $existing );
		$incoming_ids = array();

		foreach ( $incoming as $item ) {
			if ( ! empty( $item['id'] ) ) {
				$incoming_ids[] = (int) $item['id'];
			}
		}

		// Delete removed.
		foreach ( $existing_ids as $eid ) {
			if ( ! in_array( $eid, $incoming_ids, true ) ) {
				TicketPrice::delete_by_sale_period_id( $eid );
				TicketSalePeriod::delete( $eid );
			}
		}

		// Update existing / insert new.
		foreach ( $incoming as $index => $item ) {
			$name       = isset( $item['name'] ) ? sanitize_text_field( $item['name'] ) : null;
			$sale_start = sanitize_text_field( $item['sale_start'] ?? '' );
			$sale_end   = sanitize_text_field( $item['sale_end'] ?? '' );
			$sort_order = $index;

			if ( ! empty( $item['id'] ) && in_array( (int) $item['id'], $existing_ids, true ) ) {
				TicketSalePeriod::update(
					(int) $item['id'],
					array(
						'name'       => $name,
						'sale_start' => $sale_start,
						'sale_end'   => $sale_end,
						'sort_order' => $sort_order,
					)
				);
			} else {
				TicketSalePeriod::create( $event_date_id, $name, $sale_start, $sale_end, $sort_order );
			}
		}
	}

	/**
	 * Build the full response for ticket config
	 *
	 * @param int        $event_date_id Event date ID.
	 * @param EventDates $event_date    Event date object.
	 * @return array Response data.
	 */
	private function build_response( $event_date_id, $event_date ) {
		$ticket_types = TicketType::get_all_by_event_date_id( $event_date_id );
		$sale_periods = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		$prices       = TicketPrice::get_all_by_event_date_id( $event_date_id );
		$raw_settings = EventDateSetting::get_all_for_event_date( $event_date_id );

		$settings = array();
		foreach ( $raw_settings as $key => $value ) {
			$settings[ $key ] = '1' === $value;
		}

		return array(
			'capacity'     => $event_date->capacity,
			'end_datetime' => $event_date->end_datetime,
			'ticket_types' => array_map( fn( $t ) => $t->to_array(), $ticket_types ),
			'sale_periods' => array_map( fn( $p ) => $p->to_array(), $sale_periods ),
			'prices'       => array_map( fn( $pr ) => $pr->to_array(), $prices ),
			'settings'     => $settings,
		);
	}
}
