let connectedAccountId = null;

const signUpButton = document.getElementById("sign-up-button");
signUpButton.onclick = async () => {
  document.getElementById("dev-callout").classList.remove("hidden");
  document.getElementById("creating-connected-account").classList.remove("hidden");
  document.getElementById("error").classList.add("hidden");
  document.getElementById("sign-up-button").classList.add("hidden");

  fetch("/account.php", {
    method: "POST",
  })
    .then((response) => response.json())
    .then((json) => {
      const {account, error} = json;

      if (error) {
        document.getElementById("error").classList.remove("hidden");
        document.getElementById("sign-up-button").classList.remove("hidden");
        document.getElementById("creating-connected-account").classList.add("hidden");
        document.getElementById("dev-callout").classList.add("hidden");
        return;
      }

      connectedAccountId = account;

      const connectedAccountIdElement = document.getElementById("connected-account-id");
      connectedAccountIdElement.innerHTML = `Your connected account ID is: <code class="bold">${connectedAccountId}</code>`;
      connectedAccountIdElement.classList.remove("hidden");

      document.getElementById("add-information-button").classList.remove("hidden");
      document.getElementById("creating-connected-account").classList.add("hidden");
      document.getElementById("title").classList.add("hidden");
      document.getElementById("subtitle").classList.add("hidden");
      document.getElementById("add-information-title").classList.remove("hidden");
      document.getElementById("add-information-subtitle").classList.remove("hidden");
    });
};

const createAccountLinkAndRedirect = async () => {
  document.getElementById("adding-onboarding-information").classList.remove("hidden");
  document.getElementById("error").classList.add("hidden");
  document.getElementById("add-information-button").classList.add("hidden");
  fetch("/account_link.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account: connectedAccountId,
    }),
  })
    .then((response) => response.json())
    .then((json) => {
      const {url, error} = json;

      if (error) {
        document.getElementById("error").classList.remove("hidden");
        document.getElementById("add-information-button").classList.remove("hidden");
        return;
      }

      document.getElementById("adding-onboarding-information").classList.add("hidden");
      window.location.href = url;
    });
};

const addInformationButton = document.getElementById("add-information-button");
addInformationButton.onclick = createAccountLinkAndRedirect;

const path = window.location.pathname;
const parts = path.split("/");
const route = parts[1];

if (route === "return") {
  document.getElementById("title").classList.add("hidden");
  document.getElementById("subtitle").classList.add("hidden");
  document.getElementById("sign-up-button").classList.add("hidden");
  document.getElementById("details-submitted-title").classList.remove("hidden");
  document.getElementById("details-submitted-subtitle").classList.remove("hidden");
} else if (route === "refresh") {
  connectedAccountId = parts[2];
  createAccountLinkAndRedirect(connectedAccountId);
}