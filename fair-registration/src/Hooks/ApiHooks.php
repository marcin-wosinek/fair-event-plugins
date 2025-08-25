<?php
/**
 * API hooks for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Hooks;

use FairRegistration\Api\Controllers\RegistrationsController;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress REST API-related hooks
 */
class ApiHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_rest_routes() {
		$registrations_controller = new RegistrationsController();
		$registrations_controller->register_routes();
	}
}