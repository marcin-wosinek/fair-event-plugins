<?php
/**
 * GroupFee REST API Controller for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\API;

use FairMembership\Models\GroupFee;
use FairMembership\Models\UserFee;
use FairMembership\Models\Membership;
use FairMembership\Models\Group;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * GroupFee REST API Controller
 */
class GroupFeeController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-membership/v1';

	/**
	 * REST base for group fees
	 *
	 * @var string
	 */
	protected $rest_base = 'group-fees';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-membership/v1/group-fees - List all group fees
		// POST /fair-membership/v1/group-fees - Create group fee
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'group_id' => array(
							'description' => __( 'Filter by group ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
						'page'     => array(
							'description' => __( 'Page number.', 'fair-membership' ),
							'type'        => 'integer',
							'default'     => 1,
						),
						'per_page' => array(
							'description' => __( 'Items per page.', 'fair-membership' ),
							'type'        => 'integer',
							'default'     => 20,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'title'          => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'description'    => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
						'default_amount' => array(
							'required' => true,
							'type'     => 'number',
							'minimum'  => 0,
						),
						'due_date'       => array(
							'type'   => 'string',
							'format' => 'date',
						),
						'group_id'       => array(
							'required' => true,
							'type'     => 'integer',
						),
					),
				),
			)
		);

		// GET /fair-membership/v1/group-fees/{id} - Get single group fee
		// PUT /fair-membership/v1/group-fees/{id} - Update group fee
		// DELETE /fair-membership/v1/group-fees/{id} - Delete group fee
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'title'          => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'description'    => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
						'default_amount' => array(
							'type'    => 'number',
							'minimum' => 0,
						),
						'due_date'       => array(
							'type'   => 'string',
							'format' => 'date',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);

		// GET /fair-membership/v1/group-fees/{id}/user-fees - List user fees for this group fee
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/user-fees',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_user_fees' ),
				'permission_callback' => array( $this, 'get_item_permissions_check' ),
			)
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to view group fees.', 'fair-membership' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Check permissions for creating item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function create_item_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to create group fees.', 'fair-membership' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Check permissions for getting single item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		return $this->get_items_permissions_check( $request );
	}

	/**
	 * Check permissions for updating item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function update_item_permissions_check( $request ) {
		return $this->create_item_permissions_check( $request );
	}

	/**
	 * Check permissions for deleting item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function delete_item_permissions_check( $request ) {
		return $this->create_item_permissions_check( $request );
	}

	/**
	 * Get group fees
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$page     = $request->get_param( 'page' );
		$per_page = $request->get_param( 'per_page' );
		$group_id = $request->get_param( 'group_id' );

		$args = array(
			'group_id' => $group_id,
			'limit'    => $per_page,
			'offset'   => ( $page - 1 ) * $per_page,
		);

		$group_fees = GroupFee::get_all( $args );
		$total      = GroupFee::get_count( $args );

		// Enrich with group information and payment totals
		$enriched_fees = array();
		foreach ( $group_fees as $group_fee ) {
			$fee_array = $group_fee->to_array();

			// Add group name if group exists
			if ( $group_fee->group_id ) {
				$group = Group::get_by_id( $group_fee->group_id );
				if ( $group ) {
					$fee_array['group_name'] = $group->name;
				}
			}

			// Calculate payment totals from user fees
			$user_fees = UserFee::get_all( array( 'group_fee_id' => $group_fee->id ) );

			$total_paid      = 0;
			$payment_pending = 0;

			foreach ( $user_fees as $user_fee ) {
				if ( 'paid' === $user_fee->status ) {
					$total_paid += $user_fee->amount;
				} elseif ( in_array( $user_fee->status, array( 'pending', 'overdue' ), true ) ) {
					$payment_pending += $user_fee->amount;
				}
			}

			$fee_array['total_paid']      = $total_paid;
			$fee_array['payment_pending'] = $payment_pending;

			$enriched_fees[] = $fee_array;
		}

		$response = new WP_REST_Response( $enriched_fees );
		$response->header( 'X-WP-Total', $total );
		$response->header( 'X-WP-TotalPages', ceil( $total / $per_page ) );

		return $response;
	}

	/**
	 * Create group fee and user fees for all group members
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$group_fee                 = new GroupFee();
		$group_fee->title          = $request->get_param( 'title' );
		$group_fee->description    = $request->get_param( 'description' );
		$group_fee->default_amount = $request->get_param( 'default_amount' );
		$group_fee->due_date       = $request->get_param( 'due_date' );
		$group_fee->group_id       = $request->get_param( 'group_id' );
		$group_fee->created_by     = get_current_user_id();

		// Validate
		$validation = $group_fee->validate();
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		// Save group fee
		$result = $group_fee->save();
		if ( ! $result ) {
			return new WP_Error(
				'save_failed',
				__( 'Failed to save group fee.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		// Create user fees for all active members
		$memberships   = Membership::get_active_by_group( $group_fee->group_id );
		$created_count = 0;

		foreach ( $memberships as $membership ) {
			$user_fee               = new UserFee();
			$user_fee->group_fee_id = $group_fee->id;
			$user_fee->user_id      = $membership->user_id;
			$user_fee->title        = $group_fee->title;
			$user_fee->amount       = $group_fee->default_amount;
			$user_fee->due_date     = $group_fee->due_date;
			$user_fee->status       = 'pending';

			if ( $user_fee->save() ) {
				++$created_count;
			}
		}

		return new WP_REST_Response(
			array(
				'group_fee'         => $group_fee->to_array(),
				'user_fees_created' => $created_count,
			),
			201
		);
	}

	/**
	 * Get single group fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$id        = $request->get_param( 'id' );
		$group_fee = GroupFee::get_by_id( $id );

		if ( ! $group_fee ) {
			return new WP_Error(
				'not_found',
				__( 'Group fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $group_fee->to_array() );
	}

	/**
	 * Update group fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id        = $request->get_param( 'id' );
		$group_fee = GroupFee::get_by_id( $id );

		if ( ! $group_fee ) {
			return new WP_Error(
				'not_found',
				__( 'Group fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Update fields if provided
		if ( $request->has_param( 'title' ) ) {
			$group_fee->title = $request->get_param( 'title' );
		}
		if ( $request->has_param( 'description' ) ) {
			$group_fee->description = $request->get_param( 'description' );
		}
		if ( $request->has_param( 'default_amount' ) ) {
			$group_fee->default_amount = $request->get_param( 'default_amount' );
		}
		if ( $request->has_param( 'due_date' ) ) {
			$group_fee->due_date = $request->get_param( 'due_date' );
		}

		// Validate
		$validation = $group_fee->validate();
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		// Save
		$result = $group_fee->save();
		if ( ! $result ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update group fee.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $group_fee->to_array() );
	}

	/**
	 * Delete group fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id        = $request->get_param( 'id' );
		$group_fee = GroupFee::get_by_id( $id );

		if ( ! $group_fee ) {
			return new WP_Error(
				'not_found',
				__( 'Group fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		$result = $group_fee->delete();
		if ( ! $result ) {
			return new WP_Error(
				'delete_failed',
				__( 'Failed to delete group fee.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'id'      => $id,
			)
		);
	}

	/**
	 * Get user fees for a group fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_user_fees( $request ) {
		$id        = $request->get_param( 'id' );
		$group_fee = GroupFee::get_by_id( $id );

		if ( ! $group_fee ) {
			return new WP_Error(
				'not_found',
				__( 'Group fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		$user_fees = UserFee::get_all( array( 'group_fee_id' => $id ) );

		return new WP_REST_Response( $user_fees );
	}
}
