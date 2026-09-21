<?php
/**
 * Channel double for the digest delivery tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Hooks;

use FairPaymentsConnectorExperimental\Services\NotificationChannel;

/**
 * Channel that records what it is asked to send and can be told to fail.
 */
class FakeChannel implements NotificationChannel {

	/**
	 * Recorded sends as [ destination, text ].
	 *
	 * @var array[]
	 */
	public $sent = array();

	/**
	 * Result to report.
	 *
	 * @var bool
	 */
	public $result = true;

	/**
	 * Exception to throw instead of reporting a result.
	 *
	 * @var \Throwable|null
	 */
	public $throw = null;

	/**
	 * Called with each send before it is recorded, for simulating overlap.
	 *
	 * @var callable|null
	 */
	public $on_send = null;

	/**
	 * Record a send.
	 *
	 * @param string $destination Destination.
	 * @param string $text        Message.
	 * @return bool
	 * @throws \Throwable When configured to.
	 */
	public function send( string $destination, string $text ): bool {
		if ( $this->on_send ) {
			call_user_func( $this->on_send, $destination, $text );
		}
		if ( $this->throw ) {
			throw $this->throw;
		}
		$this->sent[] = array( $destination, $text );
		return $this->result;
	}
}
