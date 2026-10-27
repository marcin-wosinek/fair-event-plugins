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
	 * Recipients reported to the observer as [event, recipient], in order.
	 *
	 * @var array[]
	 */
	public $reports = array();

	/**
	 * Throw after reporting this many recipients; -1 never.
	 *
	 * @var int
	 */
	public $throw_after_reports = -1;

	/**
	 * Sent emails as [subject, html, feed ID].
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
	 * @param string        $subject  Subject.
	 * @param string        $html     Body.
	 * @param callable|null $observer Recipient observer.
	 * @param int|null      $feed_id  Feed the email lists.
	 * @return array
	 * @throws \RuntimeException When told to.
	 */
	public function send( $subject, $html, $observer = null, $feed_id = null ) {
		if ( $this->throw ) {
			throw new \RuntimeException( 'mailer down' );
		}
		foreach ( $this->reports as $index => list( $event, $recipient ) ) {
			if ( $index === $this->throw_after_reports ) {
				throw new \RuntimeException( 'mailer down' );
			}
			if ( $observer ) {
				$observer( $event, $recipient );
			}
		}
		$this->sent[] = array( $subject, $html, $feed_id );

		return $this->counts;
	}
}
