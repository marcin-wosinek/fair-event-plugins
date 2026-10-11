<?php
/**
 * WeeklyDigestMailer tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\WeeklyDigestMailer;

/**
 * The contract Fair Events calls, and where the weekly email's on/off state
 * is read from once Fair Events owns its settings.
 */
class WeeklyDigestMailerTest extends TestCase {

	/**
	 * Start without options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * The methods Fair Events checks for before it hands a send over.
	 */
	public function test_exposes_the_methods_fair_events_calls() {
		foreach ( array( 'compose', 'send_to_subscribers', 'send_test' ) as $method ) {
			$this->assertTrue( method_exists( WeeklyDigestMailer::class, $method ), $method );
		}
	}

	/**
	 * The email is rendered from Fair Events' settings with this plugin's renderer.
	 */
	public function test_compose_renders_subject_body_and_emptiness() {
		$week = array(
			'week' => array(
				'start' => '2026-10-05',
				'end'   => '2026-10-11',
			),
			'days' => array(
				array(
					'weekday'    => 'Monday',
					'month_name' => 'October',
					'day_num'    => 5,
					'events'     => array(
						array(
							'title'      => 'Concert',
							'start_time' => '19:00',
							'url'        => '',
						),
					),
				),
			),
		);

		$email = WeeklyDigestMailer::compose(
			$week,
			array(
				'subject' => 'Events {week_start} – {week_end}',
				'intro'   => 'Hello',
				'outro'   => 'Bye',
			)
		);

		$this->assertSame( 'Events 2026-10-05 – 2026-10-11', $email['subject'] );
		$this->assertStringContainsString( 'Concert', $email['html'] );
		$this->assertStringContainsString( 'Hello', $email['html'] );
		$this->assertStringContainsString( 'Bye', $email['html'] );
		$this->assertFalse( $email['empty'] );

		$week['days'][0]['events'] = array();
		$this->assertTrue( WeeklyDigestMailer::compose( $week, array() )['empty'] );
	}

	/**
	 * Before Fair Events took the email over, this plugin's former setting says.
	 */
	public function test_enabled_state_comes_from_the_former_setting_before_the_takeover() {
		$this->assertFalse( WeeklyDigestMailer::is_enabled() );
		$this->assertFalse( WeeklyDigestMailer::is_configured() );

		$GLOBALS['_fair_test_options'][ WeeklyDigestMailer::LEGACY_OPTION ] = array( 'enabled' => true );

		$this->assertTrue( WeeklyDigestMailer::is_enabled() );
		$this->assertTrue( WeeklyDigestMailer::is_configured() );
	}

	/**
	 * After the takeover only Fair Events' settings count — the former copy is switched off.
	 */
	public function test_enabled_state_comes_from_fair_events_after_the_takeover() {
		$GLOBALS['_fair_test_options'][ WeeklyDigestMailer::OWNERSHIP_OPTION ] = array( 'bulk_email' => array( 'migrated_at' => '2026-10-11 12:00:00' ) );
		$GLOBALS['_fair_test_options'][ WeeklyDigestMailer::LEGACY_OPTION ]    = array( 'enabled' => false );
		$GLOBALS['_fair_test_options'][ WeeklyDigestMailer::SETTINGS_OPTION ]  = array( 'enabled' => true );

		$this->assertTrue( WeeklyDigestMailer::is_enabled() );

		$GLOBALS['_fair_test_options'][ WeeklyDigestMailer::SETTINGS_OPTION ]['enabled'] = false;
		$GLOBALS['_fair_test_options'][ WeeklyDigestMailer::LEGACY_OPTION ]['enabled']   = true;

		$this->assertFalse( WeeklyDigestMailer::is_enabled() );
	}

	/**
	 * The option names are a contract with Fair Events.
	 */
	public function test_option_names_match_fair_events() {
		$root = dirname( __DIR__, 3 ) . '/fair-events/src/Notifications/';

		$this->assertStringContainsString( "'" . WeeklyDigestMailer::SETTINGS_OPTION . "'", file_get_contents( $root . 'BulkEmailSettings.php' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$ownership = file_get_contents( $root . 'Ownership.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$this->assertStringContainsString( "'" . WeeklyDigestMailer::OWNERSHIP_OPTION . "'", $ownership );
		$this->assertStringContainsString( "BULK_EMAIL = 'bulk_email'", $ownership );
		$migration = file_get_contents( $root . 'Migration.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$this->assertStringContainsString( "'" . WeeklyDigestMailer::LEGACY_OPTION . "'", $migration );
		$this->assertStringContainsString( "'" . WeeklyDigestMailer::LEGACY_CRON_HOOK . "'", $migration );
	}
}
