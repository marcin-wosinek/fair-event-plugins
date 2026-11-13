<?php
/**
 * Connections REST API Controller
 *
 * @package FairPlatform
 */

namespace FairPlatform\API;

use FairPlatform\Database\ConnectionRepository;

defined( 'WPINC' ) || die;

/**
 * Connections REST API controller
 */
class ConnectionsController extends AbstractConnectionsController {

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'connections';

	/**
	 * Repository for this connection log.
	 *
	 * @return ConnectionRepository
	 */
	protected function create_repository() {
		return new ConnectionRepository();
	}

	/**
	 * Statuses the listing advertises as filters.
	 *
	 * @return string[]
	 */
	protected function get_statuses() {
		return array( 'connected', 'failed', 'disconnected' );
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
			__( 'Deleted %d old connection logs.', 'fair-platform' ),
			$deleted
		);
	}

	/**
	 * Error message for users without access.
	 *
	 * @return string
	 */
	protected function get_forbidden_message() {
		return __( 'You do not have permission to view connection logs.', 'fair-platform' );
	}
}
