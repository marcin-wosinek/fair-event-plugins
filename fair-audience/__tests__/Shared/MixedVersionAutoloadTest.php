<?php
/**
 * Mixed-version autoloading of the shared confirmation renderer (#2126).
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Shared;

use Composer\Autoload\ClassLoader;
use FairEventsShared\Notifications\BookingConfirmationDocument;
use FairEventsShared\Notifications\BookingConfirmationEmail;
use FairEventsShared\Notifications\EmailLayout;
use FairEventsShared\Notifications\SignupConfirmationEmail;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Each plugin bundles its own copy of fair-events/shared and registers its
 * Composer loader with prepend, so the plugin loaded last answers first.
 * A sibling that has not been updated can therefore win the race for a
 * shared class. These tests register a stale sibling's loader before and
 * after an updated one, each in a fresh process because a class loads only
 * once, and check that the organizer's message still reaches the email.
 */
class MixedVersionAutoloadTest extends TestCase {

	private const MESSAGE = '<p>Doors open at 9.</p><p><a href="https://example.com/venue">Venue</a></p>';

	/**
	 * Register a sibling plugin's shared-package loader the way Composer does.
	 *
	 * @param string $src_dir Directory mapped to the FairEventsShared\ namespace.
	 */
	private function register_sibling( string $src_dir ): void {
		$loader = new ClassLoader();
		$loader->addPsr4( 'FairEventsShared\\', $src_dir );
		$loader->register( true );
	}

	/**
	 * Directory of a pre-#2126 copy of the shared package.
	 *
	 * @return string Path.
	 */
	private function stale_dir(): string {
		return dirname( __DIR__ ) . '/fixtures/stale-shared';
	}

	/**
	 * This plugin's installed copy of the shared package, as it ships.
	 *
	 * @return string Path.
	 */
	private function updated_dir(): string {
		return dirname( __DIR__, 2 ) . '/vendor/fair-events/shared/src';
	}

	/**
	 * Render a confirmation carrying the organizer's message.
	 *
	 * @return string HTML body.
	 */
	private function render(): string {
		return BookingConfirmationEmail::html(
			array(
				'event_title'         => 'Test Event',
				'participant_name'    => 'Jane Doe',
				'site_name'           => 'Test Site',
				'custom_message_html' => self::MESSAGE,
				'greeting_template'   => 'Hi %s,',
				'sign_off_template'   => 'Thanks,%1$sThe %2$s Team',
			)
		);
	}

	/**
	 * A stale sibling loaded after the updated plugin answers first, yet the
	 * message survives because the stale copy has no BookingConfirmationEmail.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_message_renders_when_stale_sibling_loads_last(): void {
		$this->register_sibling( $this->updated_dir() );
		$this->register_sibling( $this->stale_dir() );

		// The scenario is real: the stale copy wins the original class...
		$this->assertStringStartsWith(
			$this->stale_dir(),
			( new \ReflectionClass( SignupConfirmationEmail::class ) )->getFileName()
		);

		// ...and through it the message is dropped.
		$this->assertStringNotContainsString(
			'Doors open at 9.',
			SignupConfirmationEmail::html( array( 'custom_message_html' => self::MESSAGE ) )
		);

		$this->assertSame( 1, substr_count( $this->render(), self::MESSAGE ) );
	}

	/**
	 * With the stale sibling registered first, the updated loader answers
	 * first and the message renders once.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_message_renders_when_stale_sibling_loads_first(): void {
		$this->register_sibling( $this->stale_dir() );
		$this->register_sibling( $this->updated_dir() );

		$this->assertSame( 1, substr_count( $this->render(), self::MESSAGE ) );
	}

	/**
	 * Render a confirmation in the common design (#2322).
	 *
	 * @return string HTML body.
	 */
	private function render_document(): string {
		return BookingConfirmationDocument::html(
			array(
				'event_title'         => 'Test Event',
				'participant_name'    => 'Jane Doe',
				'site_name'           => 'Test Site',
				'custom_message_html' => self::MESSAGE,
				'greeting_template'   => 'Hi %s,',
				'sign_off_template'   => 'Thanks,%1$sThe %2$s Team',
			)
		);
	}

	/**
	 * Assert the common-design classes came from the updated copy and
	 * rendered the fluid layout with the message once.
	 */
	private function assert_document_from_updated_copy(): void {
		$html = $this->render_document();

		foreach ( array( BookingConfirmationDocument::class, EmailLayout::class ) as $class ) {
			$this->assertStringStartsWith(
				$this->updated_dir(),
				( new \ReflectionClass( $class ) )->getFileName()
			);
		}
		$this->assertSame( 1, substr_count( $html, self::MESSAGE ) );
		$this->assertStringContainsString( 'max-width: 600px', $html );
	}

	/**
	 * A stale sibling that loads last and has no common-design classes can't
	 * shadow them: they resolve from the updated copy.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_common_design_renders_when_stale_sibling_loads_last(): void {
		$this->register_sibling( $this->updated_dir() );
		$this->register_sibling( $this->stale_dir() );

		$this->assert_document_from_updated_copy();
	}

	/**
	 * With the stale sibling registered first, the common design still
	 * renders from the updated copy.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_common_design_renders_when_stale_sibling_loads_first(): void {
		$this->register_sibling( $this->stale_dir() );
		$this->register_sibling( $this->updated_dir() );

		$this->assert_document_from_updated_copy();
	}
}
