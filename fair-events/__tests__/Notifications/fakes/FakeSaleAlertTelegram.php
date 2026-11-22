<?php
/**
 * FakeSaleAlertTelegram test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\TelegramProvider;

/**
 * Telegram transport that records HTML messages.
 */
class FakeSaleAlertTelegram extends TelegramProvider {

	/**
	 * Sent messages: `{ chat_id, html }`.
	 *
	 * @var array[]
	 */
	public $sent = array();

	/**
	 * Result of the next sends.
	 *
	 * @var array
	 */
	public $result = array(
		'state'   => 'sent',
		'code'    => '',
		'message' => '',
	);

	/**
	 * Credential problem to report.
	 *
	 * @var array|null
	 */
	public $problem = null;

	/**
	 * Called during a send, e.g. a competing worker.
	 *
	 * @var callable|null
	 */
	public $during_send = null;

	/**
	 * Record a message.
	 *
	 * @param string $destination Chat.
	 * @param string $html        Message.
	 * @return array
	 */
	public function send_html( $destination, $html ) {
		$this->sent[] = array(
			'chat_id' => $destination,
			'html'    => $html,
		);
		if ( $this->during_send ) {
			( $this->during_send )();
		}
		return $this->result;
	}

	/**
	 * Credential problem.
	 *
	 * @return array|null
	 */
	public function credential_problem() {
		return $this->problem;
	}
}
