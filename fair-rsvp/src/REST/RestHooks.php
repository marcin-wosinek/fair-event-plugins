<?php
/**
 * REST API hooks for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\REST;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress REST API hooks and endpoints
 */
class RestHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		$rsvp_controller = new \FairRsvp\REST\RsvpController();
		$rsvp_controller->register_routes();
	}
}
