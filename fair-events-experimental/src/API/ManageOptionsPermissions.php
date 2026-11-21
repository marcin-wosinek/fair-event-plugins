<?php
/**
 * Administrator-only permission checks shared by REST controllers.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use WP_Error;
use WP_REST_Request;

defined( 'WPINC' ) || die;

/**
 * Gives every `*_permissions_check` of a `WP_REST_Controller` the same
 * `manage_options` requirement.
 *
 * The using class supplies the 403 message through
 * `manage_permission_message()`.
 */
// The checks keep WP_REST_Controller's signatures, so $request stays unused.
// phpcs:disable Generic.CodeAnalysis.UnusedFunctionParameter.Found
trait ManageOptionsPermissions {

	/**
	 * Message for the `rest_forbidden` error.
	 *
	 * @return string Translated message.
	 */
	abstract protected function manage_permission_message();

	/**
	 * Require `manage_options`.
	 *
	 * @return true|WP_Error
	 */
	private function check_manage_permission() {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			$this->manage_permission_message(),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	/**
	 * Check permission to list items.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		return $this->check_manage_permission();
	}

	/**
	 * Check permission to read an item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		return $this->check_manage_permission();
	}

	/**
	 * Check permission to create an item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function create_item_permissions_check( $request ) {
		return $this->check_manage_permission();
	}

	/**
	 * Check permission to update an item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function update_item_permissions_check( $request ) {
		return $this->check_manage_permission();
	}

	/**
	 * Check permission to delete an item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function delete_item_permissions_check( $request ) {
		return $this->check_manage_permission();
	}
}
