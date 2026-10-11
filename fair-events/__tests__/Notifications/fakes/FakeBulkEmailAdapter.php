<?php
/**
 * FakeBulkEmailAdapter test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailAdapter;

/**
 * Fair Audience stand-in that records sends.
 */
class FakeBulkEmailAdapter extends BulkEmailAdapter {

	/**
	 * Availability to report.
	 *
	 * @var string
	 */
	public $availability = BulkEmailAdapter::ACTIVE;

	/**
	 * Whether sending throws.
	 *
	 * @var bool
	 */
	public $throw = false;

	/**
	 * Recipient counts a send reports.
	 *
	 * @var array
	 */
	public $counts = array(
		'sent'    => 12,
		'failed'  => 0,
		'skipped' => 3,
	);

	/**
	 * Sent emails as [subject, html].
	 *
	 * @var array[]
	 */
	public $sent = array();

	/**
	 * Availability.
	 *
	 * @return string
	 */
	public function availability() {
		return $this->availability;
	}

	/**
	 * Compose.
	 *
	 * @param array $week     Week.
	 * @param array $settings Settings.
	 * @return array
	 */
	public function compose( array $week, array $settings ) {
		return array(
			'subject' => $settings['subject'],
			'html'    => '<p>events</p>',
			'empty'   => empty( $week['days'][0]['events'] ),
		);
	}

	/**
	 * Send.
	 *
	 * @param string $subject Subject.
	 * @param string $html    Body.
	 * @return array
	 * @throws \RuntimeException When told to.
	 */
	public function send( $subject, $html ) {
		if ( $this->throw ) {
			throw new \RuntimeException( 'mailer down' );
		}
		$this->sent[] = array( $subject, $html );

		return $this->counts;
	}
}
