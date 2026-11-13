<?php
/**
 * Instagram Connections REST API Controller
 *
 * @package FairPlatform
 */

namespace FairPlatform\API;

use FairPlatform\Database\InstagramConnectionRepository;

defined( 'WPINC' ) || die;

/**
 * Instagram Connections REST API controller
 */
class InstagramConnectionsController extends AbstractConnectionsController {

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'instagram-connections';

	/**
	 * Repository for this connection log.
	 *
	 * @return InstagramConnectionRepository
	 */
	protected function create_repository() {
		return new InstagramConnectionRepository();
	}

	/**
	 * Statuses the listing advertises as filters.
	 *
	 * @return string[]
	 */
	protected function get_statuses() {
		return array( 'connected', 'failed' );
	}

	/**
	 * Response message after a cleanup.
	 *
	 * @param int $deleted Number of deleted records.
	 * @return string
	 */
	protected function get_cleanup_message( $deleted ) {
		return sprintf(
			/* translators: %d: number of deleted records */
			__( 'Deleted %d old Instagram connection logs.', 'fair-platform' ),
			$deleted
		);
	}

	/**
	 * Error message for users without access.
	 *
	 * @return string
	 */
	protected function get_forbidden_message() {
		return __( 'You do not have permission to view Instagram connection logs.', 'fair-platform' );
	}
}
