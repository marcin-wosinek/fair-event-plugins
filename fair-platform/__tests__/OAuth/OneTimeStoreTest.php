<?php
/**
 * OneTimeStore (#2427): encrypted at rest, single use under concurrency,
 * expiry, and separate stores.
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\OAuth;

use FairPlatform\OAuth\OneTimeStore;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/OptionsTableFake.php';

/**
 * Unit tests for OneTimeStore.
 */
class OneTimeStoreTest extends TestCase {

	/**
	 * Fake table.
	 *
	 * @var OptionsTableFake
	 */
	private $table;

	/**
	 * Fresh table.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		if ( ! function_exists( 'sodium_crypto_secretbox' ) ) {
			$this->markTestSkipped( 'Sodium is not available.' );
		}
		$this->table                = new OptionsTableFake();
		$GLOBALS['wpdb']            = $this->table; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- the store reads the global $wpdb.
		$GLOBALS['_fair_test_salt'] = 'one';
	}

	/**
	 * Remove the fake.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['wpdb'], $GLOBALS['_fair_test_salt'] );
	}

	/** A record comes back once, and is stored encrypted under a hashed key. */
	public function test_record_is_encrypted_and_taken_once() {
		$store = new OneTimeStore( 'ig_handoff' );
		$key   = $store->put( array( 'access_token' => 'EAAG-secret' ), 300 );

		$this->assertMatchesRegularExpression( '/^[A-Za-z0-9_-]{43}$/', (string) $key );
		$this->assertCount( 1, $this->table->rows );
		$name  = array_key_first( $this->table->rows );
		$value = $this->table->rows[ $name ];
		$this->assertStringNotContainsString( $key, $name );
		$this->assertStringNotContainsString( 'EAAG-secret', $value );
		$this->assertStringContainsString( '|fes-enc:v1:', $value );

		$this->assertSame( array( 'access_token' => 'EAAG-secret' ), $store->take( $key ) );
		$this->assertNull( $store->take( $key ) );
		$this->assertSame( array(), $this->table->rows );
	}

	/** When a concurrent request deletes the row first, this one gets nothing. */
	public function test_concurrent_take_returns_the_record_once() {
		$store = new OneTimeStore( 'ig_handoff' );
		$key   = $store->put( array( 'n' => 1 ), 300 );

		$first                      = null;
		$this->table->before_delete = function () use ( $store, $key, &$first ) {
			$first = $store->take( $key );
		};

		$this->assertNull( $store->take( $key ) );
		$this->assertSame( array( 'n' => 1 ), $first );
	}

	/** An expired record is removed and not returned. */
	public function test_expired_record_is_not_returned() {
		$store = new OneTimeStore( 'ig_state' );
		$key   = $store->put( array( 'n' => 1 ), 300 );
		$name  = array_key_first( $this->table->rows );

		$this->table->rows[ $name ] = '100|' . explode( '|', $this->table->rows[ $name ], 2 )[1];

		$this->assertNull( $store->take( $key ) );
		$this->assertSame( array(), $this->table->rows );
	}

	/** Writing removes expired rows of the same store. */
	public function test_put_removes_expired_rows() {
		$store = new OneTimeStore( 'ig_state' );
		$store->put( array( 'n' => 1 ), 300 );
		$name                       = array_key_first( $this->table->rows );
		$this->table->rows[ $name ] = '100|x';

		$store->put( array( 'n' => 2 ), 300 );

		$this->assertArrayNotHasKey( $name, $this->table->rows );
		$this->assertCount( 1, $this->table->rows );
	}

	/** A key from one store does not open another. */
	public function test_stores_are_separate() {
		$key = ( new OneTimeStore( 'ig_state' ) )->put( array( 'n' => 1 ), 300 );

		$this->assertNull( ( new OneTimeStore( 'ig_handoff' ) )->take( $key ) );
	}

	/** Malformed keys are refused without a lookup. */
	public function test_malformed_key() {
		$this->assertNull( ( new OneTimeStore( 'ig_handoff' ) )->take( 'nope' ) );
	}

	/** A record encrypted under other keys cannot be read. */
	public function test_other_site_keys_cannot_read() {
		$store                      = new OneTimeStore( 'ig_handoff' );
		$key                        = $store->put( array( 'n' => 1 ), 300 );
		$GLOBALS['_fair_test_salt'] = 'two';

		$this->assertNull( $store->take( $key ) );
	}
}
