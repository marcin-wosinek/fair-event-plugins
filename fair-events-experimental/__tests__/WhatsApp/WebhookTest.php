<?php
/**
 * WhatsApp webhook authentication and parsing tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WhatsApp;

use FairEventsExperimental\WhatsApp\Webhook;
use PHPUnit\Framework\TestCase;

/**
 * Covers the signature check on the exact raw body and which parts of a
 * callback reach delivery records and the incoming-message hook.
 */
class WebhookTest extends TestCase {
	private const SECRET = '0123456789abcdef0123456789abcdef';
	private const WABA   = '100000000000001';
	private const PHONE  = '200000000000002';

	/**
	 * A `messages` change for a number.
	 *
	 * @param array  $value Change value without metadata.
	 * @param string $phone Phone Number ID.
	 * @return array
	 */
	private static function change( array $value, $phone = self::PHONE ) {
		return array(
			'field' => 'messages',
			'value' => array_merge(
				array(
					'messaging_product' => 'whatsapp',
					'metadata'          => array(
						'display_phone_number' => '34600000002',
						'phone_number_id'      => $phone,
					),
				),
				$value
			),
		);
	}

	/**
	 * A callback envelope.
	 *
	 * @param array $entries Entries.
	 * @return array
	 */
	private static function envelope( array $entries ) {
		return array(
			'object' => 'whatsapp_business_account',
			'entry'  => $entries,
		);
	}

	/** The signature must be the App Secret's HMAC of the exact body. */
	public function test_signature_matches_only_the_exact_body_and_secret() {
		$raw       = '{"object":"whatsapp_business_account","entry":[]}';
		$signature = 'sha256=' . hash_hmac( 'sha256', $raw, self::SECRET );

		$this->assertTrue( Webhook::valid_signature( $raw, $signature, self::SECRET ) );
		$this->assertTrue( Webhook::valid_signature( $raw, strtoupper( $signature ), self::SECRET ) );
		$this->assertFalse( Webhook::valid_signature( $raw . ' ', $signature, self::SECRET ) );
		$this->assertFalse( Webhook::valid_signature( $raw, $signature, 'another-secret-0123456789' ) );
		$this->assertFalse( Webhook::valid_signature( $raw, substr( $signature, 7 ), self::SECRET ) );
		$this->assertFalse( Webhook::valid_signature( $raw, null, self::SECRET ) );
		$this->assertFalse( Webhook::valid_signature( $raw, $signature, '' ) );
	}

	/** Anything but a WhatsApp Business Account envelope is refused. */
	public function test_rejects_other_envelopes() {
		$this->assertNull( Webhook::parse( null, self::WABA, self::PHONE ) );
		$this->assertNull(
			Webhook::parse(
				array(
					'object' => 'page',
					'entry'  => array(),
				),
				self::WABA,
				self::PHONE
			)
		);
		$this->assertNull( Webhook::parse( array( 'object' => 'whatsapp_business_account' ), self::WABA, self::PHONE ) );
	}

	/** Statuses of every matching change in a batch are kept, in order. */
	public function test_reads_statuses_from_a_batch() {
		$parsed = Webhook::parse(
			self::envelope(
				array(
					array(
						'id'      => self::WABA,
						'changes' => array(
							self::change(
								array(
									'statuses' => array(
										array(
											'id'           => 'wamid.ONE',
											'status'       => 'sent',
											'timestamp'    => '1793000000',
											'recipient_id' => '34600000123',
										),
										array(
											'id'        => 'wamid.ONE',
											'status'    => 'failed',
											'timestamp' => '1793000005',
											'errors'    => array(
												array(
													'code' => 131026,
													'title' => 'Message undeliverable for secret-should-not-leak',
												),
											),
										),
									),
								)
							),
							self::change(
								array(
									'statuses' => array(
										array(
											'id'        => 'wamid.TWO',
											'status'    => 'read',
											'timestamp' => '1793000010',
										),
									),
								)
							),
						),
					),
				)
			),
			self::WABA,
			self::PHONE
		);

		$this->assertSame( 2, $parsed['matched'] );
		$this->assertSame( 0, $parsed['ignored'] );
		$this->assertSame(
			array(
				array(
					'message_id'   => 'wamid.ONE',
					'status'       => 'sent',
					'timestamp'    => 1793000000,
					'failure_code' => null,
				),
				array(
					'message_id'   => 'wamid.ONE',
					'status'       => 'failed',
					'timestamp'    => 1793000005,
					'failure_code' => 131026,
				),
				array(
					'message_id'   => 'wamid.TWO',
					'status'       => 'read',
					'timestamp'    => 1793000010,
					'failure_code' => null,
				),
			),
			$parsed['statuses']
		);
	}

	/** Another account, another number or another field is never applied. */
	public function test_ignores_other_accounts_numbers_and_fields() {
		$status = array(
			'statuses' => array(
				array(
					'id'        => 'wamid.X',
					'status'    => 'delivered',
					'timestamp' => '1793000000',
				),
			),
		);
		$parsed = Webhook::parse(
			self::envelope(
				array(
					array(
						'id'      => '999999999999999',
						'changes' => array( self::change( $status ) ),
					),
					array(
						'id'      => self::WABA,
						'changes' => array(
							self::change( $status, '300000000000003' ),
							array(
								'field' => 'message_template_status_update',
								'value' => array( 'event' => 'APPROVED' ),
							),
						),
					),
				)
			),
			self::WABA,
			self::PHONE
		);

		$this->assertSame( 0, $parsed['matched'] );
		$this->assertSame( 3, $parsed['ignored'] );
		$this->assertSame( array(), $parsed['statuses'] );
	}

	/** Without saved IDs nothing matches. */
	public function test_nothing_matches_without_saved_ids() {
		$parsed = Webhook::parse(
			self::envelope(
				array(
					array(
						'id'      => '',
						'changes' => array( self::change( array(), '' ) ),
					),
				)
			),
			'',
			''
		);
		$this->assertSame( 0, $parsed['matched'] );
	}

	/** Untracked statuses and malformed IDs are dropped. */
	public function test_drops_untracked_statuses() {
		$parsed = Webhook::parse(
			self::envelope(
				array(
					array(
						'id'      => self::WABA,
						'changes' => array(
							self::change(
								array(
									'statuses' => array(
										array(
											'id'     => 'wamid.A',
											'status' => 'deleted',
										),
										array(
											'id'     => 'wamid <script>',
											'status' => 'delivered',
										),
										'not an array',
									),
								)
							),
						),
					),
				)
			),
			self::WABA,
			self::PHONE
		);
		$this->assertSame( 1, $parsed['matched'] );
		$this->assertSame( array(), $parsed['statuses'] );
	}

	/** Incoming messages carry only the normalized fields an opt-out needs. */
	public function test_normalizes_incoming_messages() {
		$parsed = Webhook::parse(
			self::envelope(
				array(
					array(
						'id'      => self::WABA,
						'changes' => array(
							self::change(
								array(
									'contacts' => array(
										array(
											'profile' => array( 'name' => 'Ana' ),
											'wa_id'   => '34600000123',
										),
									),
									'messages' => array(
										array(
											'from'      => '34600000123',
											'id'        => 'wamid.IN1',
											'timestamp' => '1793000020',
											'type'      => 'text',
											'text'      => array( 'body' => 'STOP' ),
										),
										array(
											'from'      => '34600000123',
											'id'        => 'wamid.IN2',
											'timestamp' => '1793000021',
											'type'      => 'image',
											'image'     => array( 'id' => 'media' ),
										),
										array(
											'from' => '+34 600',
											'id'   => 'wamid.IN3',
											'type' => 'text',
										),
									),
								)
							),
						),
					),
				)
			),
			self::WABA,
			self::PHONE
		);

		$this->assertSame(
			array(
				array(
					'id'              => 'wamid.IN1',
					'from'            => '34600000123',
					'timestamp'       => 1793000020,
					'type'            => 'text',
					'text'            => 'STOP',
					'waba_id'         => self::WABA,
					'phone_number_id' => self::PHONE,
				),
				array(
					'id'              => 'wamid.IN2',
					'from'            => '34600000123',
					'timestamp'       => 1793000021,
					'type'            => 'image',
					'text'            => null,
					'waba_id'         => self::WABA,
					'phone_number_id' => self::PHONE,
				),
			),
			$parsed['messages']
		);
	}
}
