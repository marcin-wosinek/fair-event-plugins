<?php
/**
 * FakeProvider test double.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\WeeklyNotifications\Provider;

/**
 * Provider that records sends and returns scripted results.
 */
class FakeProvider implements Provider {

	/**
	 * Sent messages as [destination, text].
	 *
	 * @var array[]
	 */
	public $sent = array();

	/**
	 * Result state per destination; default 'sent'.
	 *
	 * @var array<string, string>
	 */
	public $states = array();

	/**
	 * Destinations.
	 *
	 * @var string[]
	 */
	public $destinations = array( '@one', '@two', '@three' );

	/**
	 * Split on a marker, to exercise multi-part delivery.
	 *
	 * @var bool
	 */
	public $split_on_marker = false;

	/**
	 * Destination that throws.
	 *
	 * @var string
	 */
	public $throws_for = '';

	/**
	 * Provider key.
	 *
	 * @return string
	 */
	public function id() {
		return 'fake';
	}

	/**
	 * Destinations.
	 *
	 * @param array $settings         Settings.
	 * @param bool  $include_disabled Unused.
	 * @return string[]
	 */
	public function destinations( array $settings, $include_disabled = false ) {
		return $this->destinations;
	}

	/**
	 * Split the summary text.
	 *
	 * @param array $summary Summary.
	 * @return string[]
	 */
	public function split( array $summary ) {
		return $this->split_on_marker ? explode( '|', $summary['text'] ) : array( $summary['text'] );
	}

	/**
	 * Record a send.
	 *
	 * @param string $destination Destination.
	 * @param string $text        Text.
	 * @return array
	 * @throws \RuntimeException For the configured destination.
	 */
	public function send( $destination, $text ) {
		if ( $destination === $this->throws_for ) {
			throw new \RuntimeException( 'boom' );
		}
		$this->sent[] = array( $destination, $text );
		$state        = $this->states[ $destination ] ?? 'sent';
		return array(
			'state'   => $state,
			'code'    => 'sent' === $state ? '' : 'http_400',
			'message' => '',
		);
	}
}
