/**
 * Fair Payment Admin JavaScript
 */

import "../css/admin.scss";

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  initFairPaymentAdmin();
});

/**
 * Initialize Fair Payment Admin functionality
 */
function initFairPaymentAdmin() {
  initStripeConnectionTest();
  initPasswordToggle();
  initFormValidation();
  initCurrencySelector();
}

/**
 * Initialize Stripe connection test functionality
 */
function initStripeConnectionTest() {
  const testButton = document.getElementById(
    "test-comprehensive-stripe-connection",
  );
  if (!testButton) return;

  testButton.addEventListener("click", function () {
    const secretKey = document.getElementById("stripe_secret_key")?.value;
    const publishableKey = document.getElementById(
      "stripe_publishable_key",
    )?.value;
    const resultsDiv = document.getElementById(
      "comprehensive-stripe-test-results",
    );
    const button = this;
    const originalContent = button.innerHTML;

    if (!secretKey?.trim()) {
      showError(resultsDiv, fairPaymentAdmin.strings.enterSecretKey);
      return;
    }

    // Set loading state
    setLoadingState(button, true);
    showInfo(resultsDiv, fairPaymentAdmin.strings.testingConfiguration);

    // Call the REST API endpoint
    fetch(fairPaymentAdmin.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": fairPaymentAdmin.nonce,
      },
      body: JSON.stringify({
        secret_key: secretKey,
        publishable_key: publishableKey,
        _wpnonce: fairPaymentAdmin.nonce,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          resultsDiv.innerHTML = buildSuccessResults(data.data);
        } else {
          showError(
            resultsDiv,
            data.data?.message ||
              data.message ||
              fairPaymentAdmin.strings.unknownError,
          );
        }
      })
      .catch((error) => {
        console.error("Fair Payment API Error:", error);
        showError(
          resultsDiv,
          `${fairPaymentAdmin.strings.connectionFailed}: ${error.message}`,
        );
      })
      .finally(() => {
        setLoadingState(button, false, originalContent);
      });
  });
}

/**
 * Initialize password field toggle functionality
 */
function initPasswordToggle() {
  const toggleButtons = document.querySelectorAll(
    ".fair-payment-password-toggle",
  );

  toggleButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const input = this.previousElementSibling;
      if (input && input.type === "password") {
        input.type = "text";
        this.textContent = fairPaymentAdmin.strings.hide;
        this.setAttribute("aria-label", fairPaymentAdmin.strings.hidePassword);
      } else if (input && input.type === "text") {
        input.type = "password";
        this.textContent = fairPaymentAdmin.strings.show;
        this.setAttribute("aria-label", fairPaymentAdmin.strings.showPassword);
      }
    });
  });
}

/**
 * Initialize form validation
 */
function initFormValidation() {
  const secretKeyField = document.getElementById("stripe_secret_key");
  const publishableKeyField = document.getElementById("stripe_publishable_key");

  if (secretKeyField) {
    secretKeyField.addEventListener("blur", function () {
      validateStripeKey(this, "sk");
    });
  }

  if (publishableKeyField) {
    publishableKeyField.addEventListener("blur", function () {
      validateStripeKey(this, "pk");
    });
  }
}

/**
 * Validate Stripe key format
 */
function validateStripeKey(field, keyType) {
  const value = field.value.trim();
  if (!value) return; // Allow empty values

  const pattern = new RegExp(`^${keyType}_(test|live)_[a-zA-Z0-9]+$`);
  const isValid = pattern.test(value);

  // Remove existing validation classes
  field.classList.remove("fair-payment-valid", "fair-payment-invalid");

  // Add appropriate class
  if (isValid) {
    field.classList.add("fair-payment-valid");
  } else {
    field.classList.add("fair-payment-invalid");
  }
}

/**
 * Set button loading state
 */
function setLoadingState(button, isLoading, originalContent = null) {
  if (isLoading) {
    button.disabled = true;
    button.innerHTML = `<span class="dashicons dashicons-update-alt fair-payment-spin"></span>${fairPaymentAdmin.strings.testing}`;
  } else {
    button.disabled = false;
    button.innerHTML = originalContent || button.innerHTML;
  }
}

/**
 * Show error message
 */
function showError(container, message) {
  container.innerHTML = `<div class="notice notice-error"><p><strong>${fairPaymentAdmin.strings.testFailed}</strong></p><p>${message}</p></div>`;
}

/**
 * Show info message
 */
function showInfo(container, message) {
  container.innerHTML = `<div class="notice notice-info"><p>${message}</p></div>`;
}

/**
 * Build success results HTML
 */
function buildSuccessResults(data) {
  let html = `<div class="notice notice-success"><p><strong>${fairPaymentAdmin.strings.testSuccessful}</strong></p></div>`;

  html += '<div class="fair-payment-test-results">';

  // Secret Key Results
  html += '<div class="fair-payment-result-card fair-payment-success">';
  html += `<h4>${fairPaymentAdmin.strings.secretKey}</h4>`;
  if (data.secret_key?.valid) {
    html += `<p class="fair-payment-status-valid"><span class="dashicons dashicons-yes-alt"></span> ${fairPaymentAdmin.strings.valid}</p>`;
    html += `<p><strong>${fairPaymentAdmin.strings.mode}:</strong> ${data.secret_key.mode || "unknown"}</p>`;
  }
  html += "</div>";

  // Publishable Key Results
  const publishableStatus = data.publishable_key?.valid
    ? "success"
    : data.publishable_key
      ? "error"
      : "warning";
  html += `<div class="fair-payment-result-card fair-payment-${publishableStatus}">`;
  html += `<h4>${fairPaymentAdmin.strings.publishableKey}</h4>`;
  if (data.publishable_key) {
    if (data.publishable_key.valid) {
      html += `<p class="fair-payment-status-valid"><span class="dashicons dashicons-yes-alt"></span> ${fairPaymentAdmin.strings.valid}</p>`;
      html += `<p><strong>${fairPaymentAdmin.strings.mode}:</strong> ${data.publishable_key.mode || "unknown"}</p>`;
    } else {
      html += `<p class="fair-payment-status-invalid"><span class="dashicons dashicons-dismiss"></span> ${fairPaymentAdmin.strings.invalid}</p>`;
      html += `<p class="fair-payment-error">${data.publishable_key.error || fairPaymentAdmin.strings.unknownError}</p>`;
    }
  } else {
    html += `<p class="fair-payment-status-warning"><span class="dashicons dashicons-warning"></span> ${fairPaymentAdmin.strings.notTested}</p>`;
    html += `<p class="fair-payment-muted">${fairPaymentAdmin.strings.noPublishableKey}</p>`;
  }
  html += "</div>";

  html += "</div>";

  // Connection Details
  if (data.balance || data.connection) {
    html += '<div class="fair-payment-connection-details">';
    html += `<h4>${fairPaymentAdmin.strings.connectionDetails}</h4>`;

    if (data.connection?.response_time) {
      html += `<p><strong>${fairPaymentAdmin.strings.responseTime}:</strong> ${data.connection.response_time}ms</p>`;
    }

    if (data.balance?.currencies?.length > 0) {
      html += `<p><strong>${fairPaymentAdmin.strings.availableCurrencies}:</strong> ${data.balance.currencies.join(", ").toUpperCase()}</p>`;
    }

    if (data.connection?.api_version) {
      html += `<p><strong>${fairPaymentAdmin.strings.apiVersion}:</strong> ${data.connection.api_version}</p>`;
    }

    html += "</div>";
  }

  return html;
}

/**
 * Initialize currency selector functionality
 */
function initCurrencySelector() {
  const availableList = document.getElementById("available-currencies");
  const allowedList = document.getElementById("allowed-currencies");

  if (!availableList || !allowedList) return;

  // Make the allowed currencies sortable
  if (window.jQuery && window.jQuery.fn.sortable) {
    window.jQuery(allowedList).sortable({
      handle: ".drag-handle",
      placeholder: "ui-sortable-placeholder",
      tolerance: "pointer",
      update: function () {
        // Update hidden input order after sorting
        updateHiddenInputs();
      },
    });
  }

  // Add currency functionality
  availableList.addEventListener("click", function (e) {
    if (e.target.closest(".add-currency")) {
      const currencyItem = e.target.closest(".fair-payment-currency-item");
      if (currencyItem) {
        addCurrency(currencyItem);
      }
    }
  });

  // Remove currency functionality
  allowedList.addEventListener("click", function (e) {
    if (e.target.closest(".remove-currency")) {
      const currencyItem = e.target.closest(".fair-payment-currency-item");
      if (currencyItem) {
        removeCurrency(currencyItem);
      }
    }
  });

  function addCurrency(currencyItem) {
    const currency = currencyItem.dataset.currency;
    const currencyCode =
      currencyItem.querySelector(".currency-code").textContent;
    const currencyLabel =
      currencyItem.querySelector(".currency-label").textContent;

    // Create new item for allowed list
    const newItem = document.createElement("div");
    newItem.className = "fair-payment-currency-item";
    newItem.dataset.currency = currency;
    newItem.innerHTML = `
			<span class="dashicons dashicons-menu drag-handle" aria-label="${fairPaymentAdmin.strings.dragToReorder || "Drag to reorder"}"></span>
			<span class="currency-code">${currencyCode}</span>
			<span class="currency-label">${currencyLabel}</span>
			<button type="button" class="button button-small remove-currency" aria-label="${fairPaymentAdmin.strings.removeCurrency || "Remove currency"}">
				<span class="dashicons dashicons-minus"></span>
			</button>
			<input type="hidden" name="fair_payment_options[allowed_currencies][]" value="${currency}" />
		`;

    // Add to allowed list
    allowedList.appendChild(newItem);

    // Remove from available list
    currencyItem.remove();

    // Update sortable if jQuery is available
    if (window.jQuery && window.jQuery.fn.sortable) {
      window.jQuery(allowedList).sortable("refresh");
    }
  }

  function removeCurrency(currencyItem) {
    const currency = currencyItem.dataset.currency;
    const currencyCode =
      currencyItem.querySelector(".currency-code").textContent;
    const currencyLabel =
      currencyItem.querySelector(".currency-label").textContent;

    // Don't allow removing the last currency
    const remainingCurrencies = allowedList.querySelectorAll(
      ".fair-payment-currency-item",
    );
    if (remainingCurrencies.length <= 1) {
      alert(
        fairPaymentAdmin.strings.lastCurrencyWarning ||
          "At least one currency must be selected.",
      );
      return;
    }

    // Create new item for available list
    const newItem = document.createElement("div");
    newItem.className = "fair-payment-currency-item";
    newItem.dataset.currency = currency;
    newItem.innerHTML = `
			<span class="currency-code">${currencyCode}</span>
			<span class="currency-label">${currencyLabel}</span>
			<button type="button" class="button button-small add-currency" aria-label="${fairPaymentAdmin.strings.addCurrency || "Add currency"}">
				<span class="dashicons dashicons-plus-alt"></span>
			</button>
		`;

    // Add to available list (maintain alphabetical order)
    insertInAlphabeticalOrder(availableList, newItem);

    // Remove from allowed list
    currencyItem.remove();
  }

  function insertInAlphabeticalOrder(list, newItem) {
    const currency = newItem.dataset.currency;
    const items = Array.from(
      list.querySelectorAll(".fair-payment-currency-item"),
    );

    let inserted = false;
    for (const item of items) {
      if (currency < item.dataset.currency) {
        list.insertBefore(newItem, item);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      list.appendChild(newItem);
    }
  }

  function updateHiddenInputs() {
    // Remove existing hidden inputs
    const existingInputs = allowedList.querySelectorAll('input[type="hidden"]');
    existingInputs.forEach((input) => input.remove());

    // Add new hidden inputs in the correct order
    const currencyItems = allowedList.querySelectorAll(
      ".fair-payment-currency-item",
    );
    currencyItems.forEach((item) => {
      const currency = item.dataset.currency;
      const hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.name = "fair_payment_options[allowed_currencies][]";
      hiddenInput.value = currency;
      item.appendChild(hiddenInput);
    });
  }
}

// Export for potential external use
window.FairPaymentAdmin = {
  initStripeConnectionTest,
  initPasswordToggle,
  initFormValidation,
  initCurrencySelector,
  validateStripeKey,
};
