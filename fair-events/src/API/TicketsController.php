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
			EventDateSetting::set_multiple( $event_date_id, $this->normalize_settings( $body['settings'] ) );
		}

		// 6. Sync ticket options — only when fair-events-experimental is active.
		if ( class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			$existing_options = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $event_date_id );
			$existing_ids     = array_map( fn( $o ) => $o->id, $existing_options );
			$incoming_options = $body['options'] ?? array();
			$kept_ids         = array();
			foreach ( $incoming_options as $index => $option_data ) {
				$name                 = sanitize_text_field( $option_data['name'] ?? '' );
				$short_name_raw       = $option_data['short_name'] ?? null;
				$short_name           = ( null !== $short_name_raw && '' !== $short_name_raw )
					? sanitize_text_field( $short_name_raw )
					: null;
				$price                = isset( $option_data['price'] ) ? (float) $option_data['price'] : 0.0;
				$discounted_price_raw = $option_data['discounted_price'] ?? null;
				$discounted_price     = ( null === $discounted_price_raw || '' === $discounted_price_raw )
					? null
					: (float) $discounted_price_raw;
				$capacity_raw         = $option_data['capacity'] ?? null;
				$capacity             = ( null === $capacity_raw || '' === $capacity_raw )
					? null
					: absint( $capacity_raw );
				$derive               = ! empty( $option_data['derive_price_from_sale_period'] );
				$collaborator_ids     = isset( $option_data['collaborator_ids'] ) && is_array( $option_data['collaborator_ids'] )
					? array_values( array_unique( array_filter( array_map( 'absint', $option_data['collaborator_ids'] ) ) ) )
					: array();
				$period_prices_raw    = isset( $option_data['period_prices'] ) && is_array( $option_data['period_prices'] )
					? $option_data['period_prices']
					: array();
				if ( '' === $name ) {
					continue;
				}
				$option_id = isset( $option_data['id'] ) ? (int) $option_data['id'] : 0;
				if ( $option_id && in_array( $option_id, $existing_ids, true ) ) {
					\FairEventsExperimental\Models\TicketOption::update( $option_id, $name, $price, $index, $short_name, $discounted_price, $capacity, $derive );
					if ( class_exists( \FairEventsExperimental\Models\TicketOptionCollaborator::class ) ) {
						\FairEventsExperimental\Models\TicketOptionCollaborator::sync_for_option( $option_id, $collaborator_ids );
					}
					$kept_ids[]      = $option_id;
					$saved_option_id = $option_id;
				} else {
					$new_id = \FairEventsExperimental\Models\TicketOption::create( $event_date_id, $name, $price, $index, $short_name, $discounted_price, $capacity, $derive );
					if ( $new_id ) {
						if ( class_exists( \FairEventsExperimental\Models\TicketOptionCollaborator::class ) ) {
							\FairEventsExperimental\Models\TicketOptionCollaborator::sync_for_option( (int) $new_id, $collaborator_ids );
						}
						$kept_ids[]      = $new_id;
						$saved_option_id = (int) $new_id;
					} else {
						$saved_option_id = 0;
					}
				}

				// Replace per-period prices for this option.
				if ( $saved_option_id && class_exists( \FairEventsExperimental\Models\TicketOptionPrice::class ) ) {
					\FairEventsExperimental\Models\TicketOptionPrice::delete_by_option_id( $saved_option_id );
					if ( $derive ) {
						foreach ( $period_prices_raw as $pp ) {
							$pp_index     = (int) ( $pp['sale_period_index'] ?? -1 );
							$pp_period_id = isset( $pp['sale_period_id'] )
								? (int) $pp['sale_period_id']
								: ( $period_ids[ $pp_index ] ?? 0 );
							if ( ! $pp_period_id ) {
								continue;
							}
							$pp_price = isset( $pp['price'] ) ? (float) $pp['price'] : 0.0;
							\FairEventsExperimental\Models\TicketOptionPrice::upsert( $saved_option_id, $pp_period_id, $pp_price );
						}
					}
				}
			}
			$to_delete = array_diff( $existing_ids, $kept_ids );
			foreach ( $to_delete as $del_id ) {
				if ( class_exists( \FairEventsExperimental\Models\TicketOptionCollaborator::class ) ) {
					\FairEventsExperimental\Models\TicketOptionCollaborator::delete_by_option_id( (int) $del_id );
				}
				if ( class_exists( \FairEventsExperimental\Models\TicketOptionPrice::class ) ) {
					\FairEventsExperimental\Models\TicketOptionPrice::delete_by_option_id( (int) $del_id );
				}
				global $wpdb;
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->delete(
					$wpdb->prefix . 'fair_events_ticket_options',
					array( 'id' => $del_id ),
					array( '%d' )
				);
			}
		}

		// 7. Return refreshed response.
		$event_date = EventDates::get_by_id( $event_date_id );

		return new WP_REST_Response( $this->build_response( $event_date_id, $event_date ), 200 );
	}

	/**
	 * Import a ticket configuration, replacing the existing one atomically.
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
			if ( class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
				\FairEventsExperimental\Models\TicketTypeGroupRestriction::delete_by_ticket_type_id( $type->id );
			}
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
			$name               = sanitize_text_field( $item['name'] ?? '' );
			$capacity           = isset( $item['capacity'] ) && '' !== $item['capacity'] && null !== $item['capacity']
				? absint( $item['capacity'] )
				: null;
			$seats_per_ticket   = isset( $item['seats_per_ticket'] ) ? max( 1, absint( $item['seats_per_ticket'] ) ) : 1;
			$invitation_only    = ! empty( $item['invitation_only'] );
			$minimum_activities = isset( $item['minimum_activities'] ) ? absint( $item['minimum_activities'] ) : 0;
			$disable_at         = isset( $item['disable_at'] ) && '' !== $item['disable_at'] && null !== $item['disable_at']
				? sanitize_text_field( $item['disable_at'] )
				: null;
			$recurrence_scope   = in_array( $item['recurrence_scope'] ?? '', TicketType::RECURRENCE_SCOPES, true )
				? $item['recurrence_scope']
				: 'single_instance';

			$new_id = TicketType::create( $event_date_id, $name, $capacity, $index, $seats_per_ticket, $invitation_only, $minimum_activities, $disable_at, $recurrence_scope );
			if ( $new_id ) {
				$type_ids_by_index[ $index ] = (int) $new_id;

				$group_ids = isset( $item['group_ids'] ) && is_array( $item['group_ids'] ) ? array_map( 'absint', $item['group_ids'] ) : array();
				if ( ! empty( $group_ids ) && class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
					\FairEventsExperimental\Models\TicketTypeGroupRestriction::sync_for_ticket_type( (int) $new_id, $group_ids );
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
			EventDateSetting::set_multiple( $event_date_id, $this->normalize_settings( $body['settings'] ) );
		}

		// 7. Import ticket options — only when fair-events-experimental is active.
		if ( class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			$existing_options_for_clear = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $event_date_id );
			foreach ( $existing_options_for_clear as $existing_option ) {
				if ( class_exists( \FairEventsExperimental\Models\TicketOptionCollaborator::class ) ) {
					\FairEventsExperimental\Models\TicketOptionCollaborator::delete_by_option_id( (int) $existing_option->id );
				}
			}
			if ( class_exists( \FairEventsExperimental\Models\TicketOptionPrice::class ) ) {
				\FairEventsExperimental\Models\TicketOptionPrice::delete_by_event_date_id( $event_date_id );
			}
			\FairEventsExperimental\Models\TicketOption::delete_by_event_date_id( $event_date_id );
			$incoming_options = isset( $body['options'] ) && is_array( $body['options'] )
				? $body['options']
				: array();
			foreach ( $incoming_options as $index => $option_data ) {
				$name                 = sanitize_text_field( $option_data['name'] ?? '' );
				$short_name_raw       = $option_data['short_name'] ?? null;
				$short_name           = ( null !== $short_name_raw && '' !== $short_name_raw )
					? sanitize_text_field( $short_name_raw )
					: null;
				$price                = isset( $option_data['price'] ) ? (float) $option_data['price'] : 0.0;
				$discounted_price_raw = $option_data['discounted_price'] ?? null;
				$discounted_price     = ( null === $discounted_price_raw || '' === $discounted_price_raw )
					? null
					: (float) $discounted_price_raw;
				$capacity_raw         = $option_data['capacity'] ?? null;
				$capacity             = ( null === $capacity_raw || '' === $capacity_raw )
					? null
					: absint( $capacity_raw );
				$derive               = ! empty( $option_data['derive_price_from_sale_period'] );
				if ( '' !== $name ) {
					$new_id = \FairEventsExperimental\Models\TicketOption::create( $event_date_id, $name, $price, $index, $short_name, $discounted_price, $capacity, $derive );
					if ( $new_id ) {
						if ( isset( $option_data['collaborator_ids'] ) && is_array( $option_data['collaborator_ids'] ) && class_exists( \FairEventsExperimental\Models\TicketOptionCollaborator::class ) ) {
							$collaborator_ids = array_values(
								array_unique( array_filter( array_map( 'absint', $option_data['collaborator_ids'] ) ) )
							);
							if ( ! empty( $collaborator_ids ) ) {
								\FairEventsExperimental\Models\TicketOptionCollaborator::sync_for_option( (int) $new_id, $collaborator_ids );
							}
						}
						if ( $derive && isset( $option_data['period_prices'] ) && is_array( $option_data['period_prices'] ) && class_exists( \FairEventsExperimental\Models\TicketOptionPrice::class ) ) {
							foreach ( $option_data['period_prices'] as $pp ) {
								$pp_period_index = (int) ( $pp['sale_period_index'] ?? -1 );
								if ( ! isset( $period_ids_by_index[ $pp_period_index ] ) ) {
									continue;
								}
								$pp_price = isset( $pp['price'] ) ? (float) $pp['price'] : 0.0;
								\FairEventsExperimental\Models\TicketOptionPrice::upsert( (int) $new_id, $period_ids_by_index[ $pp_period_index ], $pp_price );
							}
						}
					}
				}
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
				if ( class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
					\FairEventsExperimental\Models\TicketTypeGroupRestriction::delete_by_ticket_type_id( $eid );
				}
				TicketType::delete( $eid );
			}
		}

		// Update existing / insert new.
		$id_map = array();
		foreach ( $incoming as $index => $item ) {
			$name               = sanitize_text_field( $item['name'] ?? '' );
			$capacity           = isset( $item['capacity'] ) && '' !== $item['capacity'] && null !== $item['capacity']
				? absint( $item['capacity'] )
				: null;
			$seats_per_ticket   = isset( $item['seats_per_ticket'] ) ? max( 1, absint( $item['seats_per_ticket'] ) ) : 1;
			$invitation_only    = ! empty( $item['invitation_only'] );
			$minimum_activities = isset( $item['minimum_activities'] ) ? absint( $item['minimum_activities'] ) : 0;
			$disable_at         = isset( $item['disable_at'] ) && '' !== $item['disable_at'] && null !== $item['disable_at']
				? sanitize_text_field( $item['disable_at'] )
				: null;
			$recurrence_scope   = in_array( $item['recurrence_scope'] ?? '', TicketType::RECURRENCE_SCOPES, true )
				? $item['recurrence_scope']
				: 'single_instance';
			$sort_order         = $index;
			$group_ids          = isset( $item['group_ids'] ) && is_array( $item['group_ids'] ) ? array_map( 'absint', $item['group_ids'] ) : array();

			if ( ! empty( $item['id'] ) && in_array( (int) $item['id'], $existing_ids, true ) ) {
				$id_map[ $index ] = (int) $item['id'];
				TicketType::update(
					(int) $item['id'],
					array(
						'name'               => $name,
						'capacity'           => $capacity,
						'seats_per_ticket'   => $seats_per_ticket,
						'invitation_only'    => $invitation_only,
						'minimum_activities' => $minimum_activities,
						'disable_at'         => $disable_at,
						'recurrence_scope'   => $recurrence_scope,
						'sort_order'         => $sort_order,
					)
				);
				if ( class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
					\FairEventsExperimental\Models\TicketTypeGroupRestriction::sync_for_ticket_type( (int) $item['id'], $group_ids );
				}
			} else {
				$new_id           = TicketType::create( $event_date_id, $name, $capacity, $sort_order, $seats_per_ticket, $invitation_only, $minimum_activities, $disable_at, $recurrence_scope );
				$id_map[ $index ] = (int) $new_id;
				if ( $new_id && ! empty( $group_ids ) && class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
					\FairEventsExperimental\Models\TicketTypeGroupRestriction::sync_for_ticket_type( (int) $new_id, $group_ids );
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
				if ( class_exists( \FairEventsExperimental\Models\TicketOptionPrice::class ) ) {
					\FairEventsExperimental\Models\TicketOptionPrice::delete_by_sale_period_id( $eid );
				}
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
	 * Normalize incoming settings payload into the string-typed values
	 * EventDateSetting expects.
	 *
	 * @param array $raw Raw settings array from request body.
	 * @return array Normalized settings.
	 */
	private function normalize_settings( $raw ) {
		$out = array();
		foreach ( $raw as $key => $value ) {
			$key = sanitize_key( $key );
			if ( in_array( $key, EventDateSetting::NUMERIC_KEYS, true ) ) {
				$out[ $key ] = (string) max( 0, (int) $value );
			} else {
				$out[ $key ] = $value ? '1' : '0';
			}
		}
		return $out;
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

		$options = class_exists( \FairEventsExperimental\Models\TicketOption::class )
			? \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $event_date_id )
			: array();

		$restrictions = class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class )
			? \FairEventsExperimental\Models\TicketTypeGroupRestriction::get_all_by_event_date_id( $event_date_id )
			: array();

		$collaborators = class_exists( \FairEventsExperimental\Models\TicketOptionCollaborator::class )
			? \FairEventsExperimental\Models\TicketOptionCollaborator::get_all_by_event_date_id( $event_date_id )
			: array();

		$option_prices = class_exists( \FairEventsExperimental\Models\TicketOptionPrice::class )
			? \FairEventsExperimental\Models\TicketOptionPrice::get_all_by_event_date_id( $event_date_id )
			: array();

		$option_prices_by_option = array();
		foreach ( $option_prices as $op ) {
			$option_prices_by_option[ $op->ticket_option_id ][] = array(
				'sale_period_id' => $op->sale_period_id,
				'price'          => $op->price,
			);
		}

		$settings = array();
		foreach ( $raw_settings as $key => $value ) {
			if ( in_array( $key, EventDateSetting::NUMERIC_KEYS, true ) ) {
				$settings[ $key ] = (int) $value;
			} else {
				$settings[ $key ] = '1' === $value;
			}
		}

		return array(
			'capacity'     => $event_date->capacity,
			'signup_price' => null !== $event_date->signup_price ? (float) $event_date->signup_price : null,
			'end_datetime' => $event_date->end_datetime,
			'ticket_types' => array_map(
				function ( $t ) use ( $restrictions ) {
					$data              = $t->to_array();
					$data['group_ids'] = $restrictions[ $t->id ] ?? array();
					return $data;
				},
				$ticket_types
			),
			'sale_periods' => array_map( fn( $p ) => $p->to_array(), $sale_periods ),
			'prices'       => array_map( fn( $pr ) => $pr->to_array(), $prices ),
			'settings'     => $settings,
			'options'      => array_map(
				function ( $o ) use ( $collaborators, $option_prices_by_option ) {
					$data                     = $o->to_array();
					$data['collaborator_ids'] = $collaborators[ $o->id ] ?? array();
					$data['period_prices']    = $option_prices_by_option[ $o->id ] ?? array();
					return $data;
				},
				$options
			),
		);
	}
}
