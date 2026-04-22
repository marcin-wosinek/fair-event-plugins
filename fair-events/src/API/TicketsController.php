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
use FairEvents\Models\TicketOption;
use FairEvents\Models\TicketTypeGroupRestriction;
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

		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/tickets/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_items' ),
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

		// 1. Update capacity + signup_price on event_dates row.
		$event_date_updates = array();
		if ( array_key_exists( 'capacity', $body ) ) {
			$event_date_updates['capacity'] = null !== $body['capacity'] ? absint( $body['capacity'] ) : null;
		}
		if ( array_key_exists( 'signup_price', $body ) ) {
			$raw_price                          = $body['signup_price'];
			$event_date_updates['signup_price'] = ( null === $raw_price || '' === $raw_price )
				? null
				: (float) $raw_price;
		}
		if ( ! empty( $event_date_updates ) ) {
			EventDates::update_by_id( $event_date_id, $event_date_updates );
		}

		// 2. Diff ticket types.
		$incoming_types = $body['ticket_types'] ?? array();
		$type_ids       = $this->sync_ticket_types( $event_date_id, $incoming_types );

		// 3. Diff sale periods.
		$incoming_periods = $body['sale_periods'] ?? array();
		$period_ids       = $this->sync_sale_periods( $event_date_id, $incoming_periods );

		// 4. Delete all prices for this event and re-insert.
		TicketPrice::delete_by_event_date_id( $event_date_id );

		$incoming_prices = $body['prices'] ?? array();
		foreach ( $incoming_prices as $price_data ) {
			$type_id   = $type_ids[ (int) ( $price_data['ticket_type_index'] ?? -1 ) ] ?? 0;
			$period_id = $period_ids[ (int) ( $price_data['sale_period_index'] ?? -1 ) ] ?? 0;
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

		// 6. Sync ticket options (delete all and re-insert).
		TicketOption::delete_by_event_date_id( $event_date_id );
		$incoming_options = $body['options'] ?? array();
		foreach ( $incoming_options as $index => $option_data ) {
			$name  = sanitize_text_field( $option_data['name'] ?? '' );
			$price = isset( $option_data['price'] ) ? (float) $option_data['price'] : 0.0;
			if ( '' !== $name ) {
				TicketOption::create( $event_date_id, $name, $price, $index );
			}
		}

		// 7. Return refreshed response.
		$event_date = EventDates::get_by_id( $event_date_id );

		return new WP_REST_Response( $this->build_response( $event_date_id, $event_date ), 200 );
	}

	/**
	 * Import a ticket configuration, replacing the existing one atomically.
	 *
	 * Prices reference ticket types and sale periods by array index into the
	 * incoming payload (ticket_type_index / sale_period_index), so the
	 * configuration is portable across events.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function import_items( $request ) {
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
		if ( ! is_array( $body ) ) {
			return new WP_Error(
				'rest_invalid_import',
				__( 'Invalid import payload.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// 1. Update capacity + signup_price on event_dates row.
		$event_date_updates = array();
		if ( array_key_exists( 'capacity', $body ) ) {
			$event_date_updates['capacity'] = null !== $body['capacity'] && '' !== $body['capacity']
				? absint( $body['capacity'] )
				: null;
		}
		if ( array_key_exists( 'signup_price', $body ) ) {
			$raw_price                          = $body['signup_price'];
			$event_date_updates['signup_price'] = ( null === $raw_price || '' === $raw_price )
				? null
				: (float) $raw_price;
		}
		if ( ! empty( $event_date_updates ) ) {
			EventDates::update_by_id( $event_date_id, $event_date_updates );
		}

		// 2. Wipe existing prices, types, and periods for a clean replace.
		TicketPrice::delete_by_event_date_id( $event_date_id );

		$existing_types = TicketType::get_all_by_event_date_id( $event_date_id );
		foreach ( $existing_types as $type ) {
			TicketTypeGroupRestriction::delete_by_ticket_type_id( $type->id );
			TicketType::delete( $type->id );
		}

		$existing_periods = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		foreach ( $existing_periods as $period ) {
			TicketSalePeriod::delete( $period->id );
		}

		// 3. Create new ticket types; track new IDs by input index.
		$type_ids_by_index = array();
		$incoming_types    = isset( $body['ticket_types'] ) && is_array( $body['ticket_types'] )
			? $body['ticket_types']
			: array();
		foreach ( $incoming_types as $index => $item ) {
			$name             = sanitize_text_field( $item['name'] ?? '' );
			$capacity         = isset( $item['capacity'] ) && '' !== $item['capacity'] && null !== $item['capacity']
				? absint( $item['capacity'] )
				: null;
			$seats_per_ticket = isset( $item['seats_per_ticket'] ) ? max( 1, absint( $item['seats_per_ticket'] ) ) : 1;
			$invitation_only  = ! empty( $item['invitation_only'] );

			$new_id = TicketType::create( $event_date_id, $name, $capacity, $index, $seats_per_ticket, $invitation_only );
			if ( $new_id ) {
				$type_ids_by_index[ $index ] = (int) $new_id;

				$group_ids = isset( $item['group_ids'] ) && is_array( $item['group_ids'] ) ? array_map( 'absint', $item['group_ids'] ) : array();
				if ( ! empty( $group_ids ) ) {
					TicketTypeGroupRestriction::sync_for_ticket_type( (int) $new_id, $group_ids );
				}
			}
		}

		// 4. Create new sale periods; track new IDs by input index.
		$period_ids_by_index = array();
		$incoming_periods    = isset( $body['sale_periods'] ) && is_array( $body['sale_periods'] )
			? $body['sale_periods']
			: array();
		foreach ( $incoming_periods as $index => $item ) {
			$name       = isset( $item['name'] ) ? sanitize_text_field( $item['name'] ) : null;
			$sale_start = sanitize_text_field( $item['sale_start'] ?? '' );
			$sale_end   = sanitize_text_field( $item['sale_end'] ?? '' );

			$new_id = TicketSalePeriod::create( $event_date_id, $name, $sale_start, $sale_end, $index );
			if ( $new_id ) {
				$period_ids_by_index[ $index ] = (int) $new_id;
			}
		}

		// 5. Create prices, resolving indices to the freshly-created IDs.
		$incoming_prices = isset( $body['prices'] ) && is_array( $body['prices'] )
			? $body['prices']
			: array();
		foreach ( $incoming_prices as $price_data ) {
			if ( ! isset( $price_data['ticket_type_index'], $price_data['sale_period_index'] ) ) {
				continue;
			}
			$type_index   = (int) $price_data['ticket_type_index'];
			$period_index = (int) $price_data['sale_period_index'];

			if ( ! isset( $type_ids_by_index[ $type_index ], $period_ids_by_index[ $period_index ] ) ) {
				continue;
			}

			$price = isset( $price_data['price'] ) ? (float) $price_data['price'] : 0;
			$cap   = isset( $price_data['capacity'] ) && null !== $price_data['capacity'] && '' !== $price_data['capacity']
				? absint( $price_data['capacity'] )
				: null;

			TicketPrice::create(
				$type_ids_by_index[ $type_index ],
				$period_ids_by_index[ $period_index ],
				$price,
				$cap
			);
		}

		// 6. Save settings.
		if ( isset( $body['settings'] ) && is_array( $body['settings'] ) ) {
			$settings = array();
			foreach ( $body['settings'] as $key => $value ) {
				$settings[ sanitize_key( $key ) ] = $value ? '1' : '0';
			}
			EventDateSetting::set_multiple( $event_date_id, $settings );
		}

		// 7. Import ticket options (delete all and re-insert).
		TicketOption::delete_by_event_date_id( $event_date_id );
		$incoming_options = isset( $body['options'] ) && is_array( $body['options'] )
			? $body['options']
			: array();
		foreach ( $incoming_options as $index => $option_data ) {
			$name  = sanitize_text_field( $option_data['name'] ?? '' );
			$price = isset( $option_data['price'] ) ? (float) $option_data['price'] : 0.0;
			if ( '' !== $name ) {
				TicketOption::create( $event_date_id, $name, $price, $index );
			}
		}

		// 8. Return refreshed response.
		$event_date = EventDates::get_by_id( $event_date_id );

		return new WP_REST_Response( $this->build_response( $event_date_id, $event_date ), 200 );
	}

	/**
	 * Sync ticket types: delete removed, update existing, insert new
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $incoming      Incoming ticket types from request.
	 * @return int[] Array mapping incoming index to ticket type ID.
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
				TicketTypeGroupRestriction::delete_by_ticket_type_id( $eid );
				TicketType::delete( $eid );
			}
		}

		// Update existing / insert new.
		$id_map = array();
		foreach ( $incoming as $index => $item ) {
			$name             = sanitize_text_field( $item['name'] ?? '' );
			$capacity         = isset( $item['capacity'] ) && '' !== $item['capacity'] && null !== $item['capacity']
				? absint( $item['capacity'] )
				: null;
			$seats_per_ticket = isset( $item['seats_per_ticket'] ) ? max( 1, absint( $item['seats_per_ticket'] ) ) : 1;
			$invitation_only  = ! empty( $item['invitation_only'] );
			$sort_order       = $index;
			$group_ids        = isset( $item['group_ids'] ) && is_array( $item['group_ids'] ) ? array_map( 'absint', $item['group_ids'] ) : array();

			if ( ! empty( $item['id'] ) && in_array( (int) $item['id'], $existing_ids, true ) ) {
				$id_map[ $index ] = (int) $item['id'];
				TicketType::update(
					(int) $item['id'],
					array(
						'name'             => $name,
						'capacity'         => $capacity,
						'seats_per_ticket' => $seats_per_ticket,
						'invitation_only'  => $invitation_only,
						'sort_order'       => $sort_order,
					)
				);
				TicketTypeGroupRestriction::sync_for_ticket_type( (int) $item['id'], $group_ids );
			} else {
				$new_id           = TicketType::create( $event_date_id, $name, $capacity, $sort_order, $seats_per_ticket, $invitation_only );
				$id_map[ $index ] = (int) $new_id;
				if ( $new_id && ! empty( $group_ids ) ) {
					TicketTypeGroupRestriction::sync_for_ticket_type( (int) $new_id, $group_ids );
				}
			}
		}
		return $id_map;
	}

	/**
	 * Sync sale periods: delete removed, update existing, insert new
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $incoming      Incoming sale periods from request.
	 * @return int[] Array mapping incoming index to sale period ID.
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
		$id_map = array();
		foreach ( $incoming as $index => $item ) {
			$name       = isset( $item['name'] ) ? sanitize_text_field( $item['name'] ) : null;
			$sale_start = sanitize_text_field( $item['sale_start'] ?? '' );
			$sale_end   = sanitize_text_field( $item['sale_end'] ?? '' );
			$sort_order = $index;

			if ( ! empty( $item['id'] ) && in_array( (int) $item['id'], $existing_ids, true ) ) {
				$id_map[ $index ] = (int) $item['id'];
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
				$new_id           = TicketSalePeriod::create( $event_date_id, $name, $sale_start, $sale_end, $sort_order );
				$id_map[ $index ] = (int) $new_id;
			}
		}
		return $id_map;
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
		$options      = TicketOption::get_all_by_event_date_id( $event_date_id );
		$restrictions = TicketTypeGroupRestriction::get_all_by_event_date_id( $event_date_id );

		$settings = array();
		foreach ( $raw_settings as $key => $value ) {
			$settings[ $key ] = '1' === $value;
		}

		return array(
			'capacity'     => $event_date->capacity,
			'signup_price' => null !== $event_date->signup_price ? (float) $event_date->signup_price : null,
			'end_datetime' => $event_date->end_datetime,
			'ticket_types' => array_map(
				function ( $t ) use ( $restrictions ) {
					$data               = $t->to_array();
					$data['group_ids'] = $restrictions[ $t->id ] ?? array();
					return $data;
				},
				$ticket_types
			),
			'sale_periods' => array_map( fn( $p ) => $p->to_array(), $sale_periods ),
			'prices'       => array_map( fn( $pr ) => $pr->to_array(), $prices ),
			'settings'     => $settings,
			'options'      => array_map( fn( $o ) => $o->to_array(), $options ),
		);
	}
}
