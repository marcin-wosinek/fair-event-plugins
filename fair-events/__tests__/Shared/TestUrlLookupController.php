<?php
/**
 * Concrete test subclass of FairEventsShared\API\AbstractUrlLookupController,
 * kept in its own file since a PHP file can't mix multiple object structure
 * declarations under phpcs's file-content sniff.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\API;

use FairEventsShared\API\AbstractUrlLookupController;
use WP_Error;
use WP_REST_Response;

/**
 * Exposes the abstract class's protected methods for direct testing.
 */
class TestUrlLookupController extends AbstractUrlLookupController {

	/**
	 * Expose validate_url_param() for direct testing.
	 *
	 * @param mixed $value Value to validate.
	 * @return bool
	 */
	public function validate_url( $value ) {
		return $this->validate_url_param( $value );
	}

	/**
	 * Expose lookup_url() for direct testing.
	 *
	 * @param string $url URL to look up.
	 * @return WP_REST_Response|WP_Error
	 */
	public function do_lookup( $url ) {
		return $this->lookup_url( $url );
	}
}
