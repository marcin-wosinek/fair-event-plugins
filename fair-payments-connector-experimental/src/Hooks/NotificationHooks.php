<?php
/**
 * Notification hooks for Fair Payments Connector Experimental
 *
 * Listens to fair_payment_paid and dispatches notifications per configured route.
 * Immediate routes fire asynchronously via wp_schedule_single_event.
 * Digest routes (hourly/daily/weekly) insert a row into the queue table.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Hooks;

use FairPaymentsConnectorExperimental\Services\TelegramService;
use FairPaymentsConnectorExperimental\Services\TelegramChannel;
use FairPaymentsConnectorExperimental\Services\EmailChannel;
use FairPaymentsConnectorExperimental\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Wires multi-channel notifications to successful-transaction events.
 */
class NotificationHooks {

	const CRON_HOOK = 'fair_payment_send_notification';

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		// Run after fair-audience handle_signup_paid (priority 10).
		add_action( 'fair_payment_paid', array( $this, 'on_payment_paid' ), 20, 2 );
		add_action( self::CRON_HOOK, array( $this, 'dispatch_route' ), 10, 1 );
	}

	/**
	 * Build notification context and schedule/queue per enabled route.
	 *
	 * The fair_payment_notification_context filter contract is unchanged —
	 * fair-audience enriches this in PaymentHooks without needing modification.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row.
	 * @return void
	 */
	public function on_payment_paid( $payment, $transaction ) {
		$routes = (array) get_option( Settings::ROUTES_OPTION, array() );
		if ( empty( $routes ) ) {
			return;
		}

		$context  = $this->build_context( $payment, $transaction );
		$service  = new TelegramService();
		$template = Settings::default_template();

		foreach ( $routes as $route ) {
			if ( empty( $route['enabled'] ) ) {
				continue;
			}

			$channel     = isset( $route['channel'] ) ? (string) $route['channel'] : '';
			$destination = isset( $route['destination'] ) ? (string) $route['destination'] : '';
			$frequency   = isset( $route['frequency'] ) ? (string) $route['frequency'] : 'immediate';
			$include_pii = isset( $route['include_pii'] ) ? (bool) $route['include_pii'] : true;
			$route_id    = isset( $route['id'] ) ? (string) $route['id'] : '';

			if ( '' === $channel || '' === $destination ) {
				continue;
			}

			$text = $service->render_template( $template, $context, $include_pii );

			if ( 'immediate' === $frequency ) {
				$payload = array(
					'channel'     => $channel,
					'destination' => $destination,
					'text'        => $text,
				);
				wp_schedule_single_event( time(), self::CRON_HOOK, array( $payload ) );
			} else {
				$this->queue_row( $route_id, $channel, $destination, $text, $context );
			}
		}
	}

	/**
	 * Cron handler for immediate routes — dispatches a single pre-rendered message.
	 *
	 * @param array $payload Array with channel, destination, text.
	 * @return void
	 */
	public function dispatch_route( $payload ) {
		if ( ! is_array( $payload ) || empty( $payload['channel'] ) || empty( $payload['text'] ) || empty( $payload['destination'] ) ) {
			return;
		}

		$channel_obj = $this->make_channel( (string) $payload['channel'] );
		if ( null === $channel_obj ) {
			return;
		}

		$channel_obj->send( (string) $payload['destination'], (string) $payload['text'] );
	}

	/**
	 * Insert a queue row for digest delivery.
	 *
	 * @param string $route_id    Route ID.
	 * @param string $channel     Channel name.
	 * @param string $destination Destination address/ID.
	 * @param string $text        Pre-rendered message body.
	 * @param array  $context     Notification context (for amount/currency).
	 * @return void
	 */
	private function queue_row( $route_id, $channel, $destination, $text, array $context ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_payment_notification_queue';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$wpdb->insert(
			$table,
			array(
				'route_id'      => $route_id,
				'channel'       => $channel,
				'destination'   => $destination,
				'rendered_text' => $text,
				'amount'        => isset( $context['amount'] ) ? (string) $context['amount'] : '',
				'currency'      => isset( $context['currency'] ) ? (string) $context['currency'] : '',
				'created_at'    => current_time( 'mysql', true ),
				'sent_at'       => null,
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', null )
		);
	}

	/**
	 * Instantiate the channel object for a given channel name.
	 *
	 * @param string $channel Channel name.
	 * @return \FairPaymentsConnectorExperimental\Services\NotificationChannel|null
	 */
	public static function make_channel( string $channel ) {
		if ( 'telegram' === $channel ) {
			return new TelegramChannel( new TelegramService() );
		}
		if ( 'email' === $channel ) {
			return new EmailChannel();
		}
		return null;
	}

	/**
	 * Parse the comma-separated chat IDs setting into a clean array.
	 *
	 * @param string $raw Raw setting value.
	 * @return string[]
	 */
	public static function parse_chat_ids( $raw ) {
		$parts = preg_split( '/[\s,]+/', (string) $raw );
		if ( ! is_array( $parts ) ) {
			return array();
		}
		return array_values( array_filter( array_map( 'trim', $parts ), 'strlen' ) );
	}

	/**
	 * Assemble the notification context for template rendering.
	 *
	 * Other plugins (fair-audience) hook `fair_payment_notification_context` to
	 * fill in participant/event details.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row.
	 * @return array
	 */
	public function build_context( $payment, $transaction ) {
		$amount   = isset( $transaction->amount ) ? $transaction->amount : null;
		$currency = isset( $transaction->currency ) ? $transaction->currency : '';
		$created  = isset( $transaction->created_at ) ? $transaction->created_at : '';
		$date     = '';
		if ( $created ) {
			$ts = strtotime( $created );
			if ( $ts ) {
				$date = gmdate( 'Y-m-d', $ts );
			}
		}

		$is_test = ! empty( $transaction->testmode );

		$base = array(
			'transaction'            => $transaction,
			'payment'                => $payment,
			'test_label'             => $is_test ? '[TEST] ' : '',
			'site_domain'            => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'amount'                 => null !== $amount ? number_format( (float) $amount, 2, '.', '' ) : '',
			'currency'               => $currency,
			'date'                   => $date,
			'transaction_id'         => isset( $transaction->id ) ? (string) $transaction->id : '',
			'event_title'            => '',
			'event_url'              => '',
			'participant_name'       => '',
			'participant_name_short' => '',
			'participant_url'        => '',
			'participant_email'      => '',
			'ticket_label'           => '',
			'activities'             => '',
			'discounts'              => '',
		);

		return apply_filters( 'fair_payment_notification_context', $base, $transaction, $payment );
	}

	/**
	 * Provide a sample context for the "Send test message" button.
	 *
	 * @return array
	 */
	public static function sample_context() {
		return array(
			'test_label'             => '[TEST] ',
			'site_domain'            => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'amount'                 => '10.00',
			'currency'               => 'EUR',
			'date'                   => gmdate( 'Y-m-d' ),
			'transaction_id'         => 'TEST-0001',
			'event_title'            => 'Sample Event',
			'event_url'              => admin_url( 'edit.php' ),
			'participant_name'       => 'Sample Participant',
			'participant_name_short' => 'Sample P.',
			'participant_url'        => admin_url( 'admin.php?page=fair-audience-participants' ),
			'participant_email'      => 'sample@example.com',
			'ticket_label'           => 'Regular',
			'activities'             => 'Sample Activity A, Sample Activity B',
			'discounts'              => 'Early bird -10%',
		);
	}
}
